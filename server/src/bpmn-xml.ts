import { SaxesParser } from "saxes";
// Narrow canonical XML grammar for server-generated safe BPMN only; not a general XML importer.
export function validateGeneratedBpmnXml(xml: string): string[] {
  const errors: string[] = [];
  if (typeof xml !== "string" || Buffer.byteLength(xml) > 512 * 1024)
    return ["XML missing or exceeds 512 KiB"];
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  if (!xml.startsWith(declaration))
    return ["XML declaration must be canonical"];
  const body = xml.slice(declaration.length);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))
    return ["invalid XML character"];
  // Only the exact generated XML vocabulary and attribute spellings are accepted. No entities,
  // declarations, comments, CDATA, processing instructions, alternate namespaces, or free text.
  if (
    /&(?!(?:amp|lt|gt|quot|apos);)|<!|<\?|--|\b(?:schemaLocation|href|src)\b/i.test(
      body,
    )
  )
    return ["forbidden XML syntax"];
  // Saxes has no external resource loader. DTD/entity declarations have already been
  // rejected before parsing; this catches malformed XML, invalid Unicode and namespaces.
  try {
    const parser = new SaxesParser({ xmlns: true });
    parser.on("error", () => {
      errors.push("malformed XML");
    });
    parser.on("doctype", () => {
      errors.push("DOCTYPE prohibited");
    });
    parser.on("processinginstruction", () => {
      errors.push("processing instruction prohibited");
    });
    parser.write(xml).close();
  } catch {
    errors.push("malformed XML");
  }
  if (errors.length) return [...new Set(errors)];
  const tokens = body.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== body) return ["malformed XML token stream"];
  const stack: string[] = [];
  let definitions = 0,
    processes = 0,
    starts = 0,
    ends = 0,
    gateways = 0;
  const single = new Set([
    "startEvent",
    "endEvent",
    "userTask",
    "exclusiveGateway",
    "parallelGateway",
  ]);
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const parent = stack.at(-1);
      if (
        parent !== "conditionExpression" ||
        !/^\$\{approvalDecision == '(?:approved|rejected)'\}$/.test(token)
      )
        errors.push("unexpected XML text");
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1);
      if (stack.pop() !== name) errors.push("mismatched XML element");
      continue;
    }
    const name = /\s/.test(token)
      ? token.slice(1).split(/[\s/>]/, 1)[0]!
      : token.slice(1, -1);
    const attrsText = token.slice(
      1 + name.length,
      token.length - (token.endsWith("/>") ? 2 : 1),
    );
    const attrs: Record<string, string> = {};
    const attrRe = /\s+([A-Za-z:]+)="([^"<>]*)"/gy;
    let pos = 0,
      match: RegExpExecArray | null;
    while (pos < attrsText.length) {
      attrRe.lastIndex = pos;
      match = attrRe.exec(attrsText);
      if (!match) {
        errors.push("invalid XML attribute syntax");
        break;
      }
      if (attrs[match[1]!] !== undefined)
        errors.push("duplicate XML attribute");
      attrs[match[1]!] = match[2]!;
      pos = attrRe.lastIndex;
    }
    const parents: Record<string, string[]> = {
      definitions: [""],
      process: ["definitions"],
      startEvent: ["process"],
      endEvent: ["process"],
      userTask: ["process"],
      exclusiveGateway: ["process"],
      parallelGateway: ["process"],
      sequenceFlow: ["process"],
      conditionExpression: ["sequenceFlow"],
    };
    if (!parents[name] || !parents[name]!.includes(stack.at(-1) ?? ""))
      errors.push("unknown XML element or invalid parent");
    const allowedAttrs: Record<string, string[]> = {
      definitions: ["xmlns", "xmlns:xsi", "xmlns:flowable", "targetNamespace"],
      process: ["id", "name", "isExecutable"],
      startEvent: ["id", "name"],
      endEvent: ["id", "name"],
      userTask: ["id", "name", "flowable:assignee", "flowable:candidateUsers", "flowable:formKey"],
      exclusiveGateway: ["id", "default"],
      parallelGateway: ["id"],
      sequenceFlow: ["id", "sourceRef", "targetRef", "name"],
      conditionExpression: ["xsi:type"],
    };
    if (Object.keys(attrs).some((k) => !allowedAttrs[name]?.includes(k)))
      errors.push("unknown XML attribute");
    if (
      name === "definitions" &&
      (attrs.xmlns !== "http://www.omg.org/spec/BPMN/20100524/MODEL" ||
        attrs["xmlns:xsi"] !== "http://www.w3.org/2001/XMLSchema-instance" ||
        attrs["xmlns:flowable"] !== "http://flowable.org/bpmn" ||
        attrs.targetNamespace !== "https://momentum.local/bpmn")
    )
      errors.push("noncanonical XML namespaces");
    if (
      name === "conditionExpression" &&
      attrs["xsi:type"] !== "tFormalExpression"
    )
      errors.push("unsupported condition expression type");
    for (const attr of ["flowable:assignee", "flowable:candidateUsers"]) {
      if (
        attrs[attr] !== undefined &&
        !/^[A-Za-z0-9_.@-]+(?:,[A-Za-z0-9_.@-]+)*$/.test(attrs[attr]!)
      )
        errors.push("unsafe identity attribute");
    }
    if (
      name === "userTask" && attrs["flowable:formKey"] !== undefined &&
      !/^plm-form:[A-Za-z][A-Za-z0-9_-]{0,63}:v[1-9][0-9]*$/.test(attrs["flowable:formKey"]!)
    ) errors.push("unsafe identity attribute");
    if (name === "definitions") definitions++;
    if (name === "process") processes++;
    if (name === "startEvent") starts++;
    if (name === "endEvent") ends++;
    if (name === "exclusiveGateway") gateways++;
    const self = token.endsWith("/>");
    if (self) {
      if (!single.has(name)) errors.push("invalid empty element");
    } else stack.push(name);
  }
  if (
    stack.length ||
    definitions !== 1 ||
    processes !== 1 ||
    starts !== 1 ||
    ends < 1
  )
    errors.push("invalid XML document structure");
  return errors;
}
export function engineReleaseBlocked(cfg: Record<string, unknown>): boolean {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BPMN_MODELER_ALLOW_TEST_MOCK !== "true"
  )
    return true;
  try {
    const u = new URL(String(cfg.baseUrl ?? ""));
    return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname);
  } catch {
    return true;
  }
}
