import { validateGeneratedBpmnXml, engineReleaseBlocked } from "./bpmn-xml.js";
export { validateGeneratedBpmnXml, engineReleaseBlocked } from "./bpmn-xml.js";
import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { db, recordSecurityEvent } from "./database.js";
import { currentWorkspaceScope, type WorkspaceScope } from "./scope.js";
import { connectorCredentialConfig } from "./integrations/configuration.js";
import {
  deployModelDefinition,
  type FlowableConfig,
} from "./integrations/flowable.js";

type NodeType = "startEvent" | "endEvent" | "userTask" | "exclusiveGateway";
type Graph = {
  key: string;
  name: string;
  nodes: Array<Record<string, unknown>>;
  flows: Array<Record<string, unknown>>;
};
const roles = ["admin", "plm_manager", "reviewer", "member"];
const tables = `CREATE TABLE IF NOT EXISTS bpmn_models(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,key TEXT NOT NULL,name TEXT NOT NULL,graph TEXT NOT NULL,revision INTEGER NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,organization_id,account_id,key)); CREATE TABLE IF NOT EXISTS bpmn_versions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,model_id TEXT NOT NULL,version INTEGER NOT NULL,graph TEXT NOT NULL,xml TEXT NOT NULL,sha256 TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(model_id,version)); CREATE TABLE IF NOT EXISTS bpmn_audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,model_id TEXT NOT NULL,actor_id TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bpmn_publish(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,model_id TEXT NOT NULL,version_id TEXT NOT NULL,status TEXT NOT NULL,deployment_id TEXT,definition_id TEXT,updated_at TEXT NOT NULL,UNIQUE(model_id,version_id));`;
db.exec(
  tables +
    ` CREATE TRIGGER IF NOT EXISTS bpmn_versions_no_update BEFORE UPDATE ON bpmn_versions BEGIN SELECT RAISE(ABORT,'immutable BPMN version'); END; CREATE TRIGGER IF NOT EXISTS bpmn_versions_no_delete BEFORE DELETE ON bpmn_versions BEGIN SELECT RAISE(ABORT,'immutable BPMN version'); END;`,
);
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS bpmn_one_unresolved_publish_per_model
  ON bpmn_publish(model_id) WHERE status IN ('deploying','uncertain');
  CREATE TRIGGER IF NOT EXISTS bpmn_audit_no_update BEFORE UPDATE ON bpmn_audit
  BEGIN SELECT RAISE(ABORT,'immutable BPMN audit'); END;
  CREATE TRIGGER IF NOT EXISTS bpmn_audit_no_delete BEFORE DELETE ON bpmn_audit
  BEGIN SELECT RAISE(ABORT,'immutable BPMN audit'); END;
`);
const tokens = new Map<
  string,
  {
    scope: string;
    model: string;
    version: string;
    hash: string;
    expires: number;
    actor: string;
    connectorHash: string;
    publishedHash: string;
    publishedVersion: string;
  }
>();
const scopeKey = (s: {
  tenantId: string;
  organizationId: string;
  accountId: string;
}) =>
  `tenant:${s.tenantId}:organization:${s.organizationId}:account:${s.accountId}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
function validate(raw: unknown): { graph: Graph; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      graph: { key: "", name: "", nodes: [], flows: [] },
      errors: ["graph must be an object"],
    };
  const g = raw as Record<string, unknown>;
  if (
    Object.keys(g).some((k) => !["key", "name", "nodes", "flows"].includes(k))
  )
    errors.push("graph contains unknown fields");
  if (typeof g.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(g.key))
    errors.push("invalid key");
  if (
    typeof g.name !== "string" ||
    !g.name.trim() ||
    g.name.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(g.name)
  )
    errors.push("invalid name");
  if (!Array.isArray(g.nodes) || g.nodes.length < 3 || g.nodes.length > 100)
    errors.push("nodes must contain 3..100 entries");
  if (!Array.isArray(g.flows) || g.flows.length < 2 || g.flows.length > 200)
    errors.push("flows must contain 2..200 entries");
  const nodes = Array.isArray(g.nodes)
      ? (g.nodes as Array<Record<string, unknown>>)
      : [],
    flows = Array.isArray(g.flows)
      ? (g.flows as Array<Record<string, unknown>>)
      : [];
  if (
    [...nodes, ...flows].some(
      (value) => !value || typeof value !== "object" || Array.isArray(value),
    )
  )
    return {
      graph: g as unknown as Graph,
      errors: [...errors, "nodes and flows must contain objects"],
    };
  if (Buffer.byteLength(JSON.stringify(raw)) > 131072)
    errors.push("graph exceeds 128 KiB");
  const ids = new Set<string>(typeof g.key === "string" ? [g.key] : []);
  const types = new Map<string, NodeType>();
  for (const n of nodes) {
    if (!n || typeof n !== "object" || Array.isArray(n)) {
      errors.push("invalid node");
      continue;
    }
    if (
      Object.keys(n).some(
        (k) => !["id", "type", "name", "assignment", "x", "y"].includes(k),
      )
    )
      errors.push("node contains unknown fields");
    if (
      typeof n.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(n.id) ||
      ids.has(n.id)
    )
      errors.push("invalid or duplicate node id");
    else ids.add(n.id);
    if (
      !["startEvent", "endEvent", "userTask", "exclusiveGateway"].includes(
        String(n.type),
      )
    )
      errors.push("unsupported node type");
    else types.set(String(n.id), n.type as NodeType);
    if (
      typeof n.name !== "string" ||
      n.name.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(n.name)
    )
      errors.push("invalid node name");
    for (const c of ["x", "y"])
      if (
        n[c] !== undefined &&
        (!Number.isFinite(n[c]) || Number(n[c]) < 0 || Number(n[c]) > 10000)
      )
        errors.push("invalid node coordinates");
    if (n.type === "userTask") {
      const a = n.assignment as Record<string, unknown> | undefined;
      if (
        !a ||
        typeof a !== "object" ||
        Array.isArray(a) ||
        Object.keys(a).some((k) => !["kind", "userIds", "role"].includes(k))
      )
        errors.push("userTask requires a valid assignment");
      else if (a.kind === "assignee" || a.kind === "candidateUsers") {
        if (a.role !== undefined)
          errors.push("user assignment cannot contain role");
        if (
          !Array.isArray(a.userIds) ||
          !a.userIds.length ||
          a.userIds.length > (a.kind === "assignee" ? 1 : 20) ||
          a.userIds.some((u) => typeof u !== "string" || !u)
        )
          errors.push("invalid assignment userIds");
      } else if (a.kind === "candidateRole") {
        if (a.userIds !== undefined)
          errors.push("role assignment cannot contain userIds");
        if (typeof a.role !== "string" || !roles.includes(a.role))
          errors.push("invalid candidateRole");
      } else errors.push("invalid assignment kind");
    } else if (n.assignment !== undefined)
      errors.push("assignment only allowed on userTask");
  }
  if (
    nodes.filter((n) => n?.type === "startEvent").length !== 1 ||
    !nodes.some((n) => n?.type === "endEvent")
  )
    errors.push("exactly one startEvent and at least one endEvent required");
  const fids = new Set<string>(),
    adj = new Map<string, string[]>(),
    rev = new Map<string, string[]>(),
    outs = new Map<string, Array<Record<string, unknown>>>();
  for (const f of flows) {
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      errors.push("invalid flow");
      continue;
    }
    if (
      Object.keys(f).some(
        (k) =>
          ![
            "id",
            "source",
            "target",
            "name",
            "condition",
            "isDefault",
          ].includes(k),
      )
    )
      errors.push("flow contains unknown fields");
    if (typeof f.id === "string" && ids.has(f.id))
      errors.push("node/flow IDs must be globally unique");
    if (
      typeof f.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.id) ||
      fids.has(f.id)
    )
      errors.push("invalid or duplicate flow id");
    else fids.add(f.id);
    if (
      typeof f.source !== "string" ||
      !types.has(f.source) ||
      typeof f.target !== "string" ||
      !types.has(f.target)
    )
      errors.push("flow endpoints must reference nodes");
    if (f.source === f.target) errors.push("self loop prohibited");
    if (
      f.name !== undefined &&
      (typeof f.name !== "string" ||
        f.name.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(f.name))
    )
      errors.push("invalid flow name");
    if (
      f.condition !== undefined &&
      !["approved", "rejected"].includes(String(f.condition))
    )
      errors.push("unsupported flow condition");
    if (f.isDefault !== undefined && typeof f.isDefault !== "boolean")
      errors.push("isDefault must be boolean");
    if (typeof f.source === "string" && typeof f.target === "string") {
      adj.set(f.source, [...(adj.get(f.source) || []), f.target]);
      rev.set(f.target, [...(rev.get(f.target) || []), f.source]);
      outs.set(f.source, [...(outs.get(f.source) || []), f]);
    }
  }
  for (const f of flows) {
    const t = types.get(String(f.source));
    if (
      (f.condition !== undefined || f.isDefault === true) &&
      t !== "exclusiveGateway"
    )
      errors.push("conditions/default only allowed from exclusiveGateway");
  }
  for (const n of nodes) {
    if (!n || typeof n.id !== "string") continue;
    const type = n.type;
    if (
      type !== "exclusiveGateway" &&
      type !== "endEvent" &&
      (outs.get(n.id)?.length || 0) !== 1
    )
      errors.push("non-gateway nodes require exactly one outgoing flow");
    if (type === "startEvent" && (rev.get(n.id)?.length || 0))
      errors.push("startEvent cannot have incoming flows");
    if (type === "endEvent" && (adj.get(n.id)?.length || 0))
      errors.push("endEvent cannot have outgoing flows");
    if (type === "exclusiveGateway") {
      const out = outs.get(n.id) || [];
      if (out.length !== 2)
        errors.push("exclusiveGateway requires exactly two outgoing flows");
      else {
        const defs = out.filter((f) => f.isDefault === true),
          cond = out.filter((f) => f.condition);
        if (!(
          (defs.length === 1 &&
            cond.length === 1 &&
            defs[0]?.condition === undefined &&
            ["approved", "rejected"].includes(String(cond[0]?.condition))) ||
          (defs.length === 0 &&
            cond.length === 2 &&
            new Set(cond.map((f) => f.condition)).size === 2)
        ))
          errors.push(
            "gateway requires approved/rejected conditions and optional default",
          );
      }
    }
  }
  const starts = nodes.filter((n) => n?.type === "startEvent");
  if (starts[0] && typeof starts[0].id === "string") {
    const walk = (map: Map<string, string[]>, start: string) => {
      const seen = new Set<string>(),
        todo = [start];
      while (todo.length) {
        const x = todo.pop()!;
        if (seen.has(x)) continue;
        seen.add(x);
        todo.push(...(map.get(x) || []));
      }
      return seen;
    };
    const reached = walk(adj, starts[0].id),
      ends = new Set(
        nodes.filter((n) => n?.type === "endEvent").map((n) => n.id),
      );
    if (reached.size !== nodes.length)
      errors.push("all nodes must be reachable from start");
    if (![...ends].some((e) => reached.has(String(e))))
      errors.push("endEvent must be reachable");
    for (const n of nodes)
      if (n?.id && !walk(adj, String(n.id)).size)
        errors.push("invalid flow graph");
    for (const n of nodes)
      if (
        n?.id &&
        types.has(String(n.id)) &&
        ![...walk(adj, String(n.id))].some((x) => ends.has(x))
      )
        errors.push("every node must reach an endEvent");
    // DAG check
    const state = new Map<string, number>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 1) return false;
      if (state.get(id) === 2) return true;
      state.set(id, 1);
      for (const t of adj.get(id) || []) if (!visit(t)) return false;
      state.set(id, 2);
      return true;
    };
    for (const id of ids)
      if (!visit(id)) {
        errors.push("cycles are not supported");
        break;
      }
  }
  if (!nodes.some((n) => n?.type === "userTask"))
    errors.push("at least one userTask required");
  return { graph: g as unknown as Graph, errors: [...new Set(errors)] };
}
function xmlFor(g: Graph): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="https://momentum.local/bpmn"><process id="${esc(g.key)}" name="${esc(g.name)}" isExecutable="true">`,
  ];
  for (const n of g.nodes) {
    if (n.type === "exclusiveGateway") {
      const d = g.flows.find((f) => f.source === n.id && f.isDefault);
      lines.push(
        `<exclusiveGateway id="${esc(String(n.id))}"${d ? ` default="${esc(String(d.id))}"` : ""}/>`,
      );
      continue;
    }
    if (n.type === "userTask") {
      const a = n.assignment as Record<string, unknown>;
      const prop = a.kind === "assignee" ? "assignee" : "candidateUsers";
      lines.push(
        `<userTask id="${esc(String(n.id))}" name="${esc(String(n.name))}" flowable:${prop}="${esc((a.userIds as string[]).join(","))}"/>`,
      );
      continue;
    }
    lines.push(
      `<${n.type} id="${esc(String(n.id))}"${n.name ? ` name="${esc(String(n.name))}"` : ""}/>`,
    );
  }
  for (const f of g.flows) {
    lines.push(
      `<sequenceFlow id="${esc(String(f.id))}" sourceRef="${esc(String(f.source))}" targetRef="${esc(String(f.target))}"${f.name ? ` name="${esc(String(f.name))}"` : ""}>`,
    );
    if (f.condition)
      lines.push(
        `<conditionExpression xsi:type="tFormalExpression">\${approvalDecision == '${f.condition}'}</conditionExpression>`,
      );
    lines.push("</sequenceFlow>");
  }
  lines.push("</process></definitions>");
  return lines.join("");
}
function resolveAssignments(scope: WorkspaceScope, graph: Graph): Graph {
  const cfg = connectorCredentialConfig(scope, "flowable"),
    map =
      cfg.userMap && typeof cfg.userMap === "object"
        ? (cfg.userMap as Record<string, unknown>)
        : {};
  const result = JSON.parse(JSON.stringify(graph)) as Graph;
  for (const n of result.nodes) {
    if (n.type !== "userTask") continue;
    const a = n.assignment as Record<string, unknown>;
    let ids = (a.userIds as string[] | undefined) || [];
    if (a.kind === "candidateRole")
      ids = (
        db
          .prepare(
            `SELECT u.id FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.role=? AND m.disabled=0 AND u.disabled=0 ORDER BY u.id`,
          )
          .all(
            scope.tenantId,
            scope.organizationId,
            scope.accountId,
            a.role,
          ) as Array<{ id: string }>
      ).map((x) => x.id);
    if (!ids.length) throw new Error("assignment has no active scoped members");
    const mapped = ids.map((id) => {
      const row = db
        .prepare(
          `SELECT u.email FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0`,
        )
        .get(id, scope.tenantId, scope.organizationId, scope.accountId) as
        { email: string } | undefined;
      if (!row) throw new Error("assignment references a non-member");
      const engine = map[row.email];
      if (typeof engine !== "string" || !engine.trim())
        throw new Error(`unmapped Flowable user: ${row.email}`);
      if (
        engine.length > 160 ||
        !/^[A-Za-z0-9_.@-]+$/.test(engine) ||
        /[,${}]/.test(engine)
      )
        throw new Error(`unsafe Flowable user mapping: ${row.email}`);
      return engine;
    });
    n.assignment = {
      kind: a.kind === "assignee" ? "assignee" : "candidateUsers",
      userIds: mapped,
    };
  }
  return result;
}

function invalidAssignments(scope: WorkspaceScope, graph: Graph): boolean {
  const q = db.prepare(
    `SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0`,
  );
  return graph.nodes.some(
    (n) =>
      n.type === "userTask" &&
      (n.assignment as Record<string, unknown>).kind !== "candidateRole" &&
      ((n.assignment as Record<string, unknown>).userIds as string[]).some(
        (id) =>
          !q.get(id, scope.tenantId, scope.organizationId, scope.accountId),
      ),
  );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function modelChanges(previous: Graph | undefined, next: Graph) {
  const changes: Array<Record<string, unknown>> = [];
  if (!previous || previous.key !== next.key || previous.name !== next.name)
    changes.push({
      kind: "process",
      change: previous ? "changed" : "added",
      before: previous ? { key: previous.key, name: previous.name } : null,
      after: { key: next.key, name: next.name },
    });
  for (const [collection, kind] of [
    ["nodes", "node"],
    ["flows", "flow"],
  ] as const) {
    const before = new Map(
      (previous?.[collection] ?? []).map((item) => [String(item.id), item]),
    );
    const after = new Map(
      next[collection].map((item) => [String(item.id), item]),
    );
    for (const [id, item] of before) {
      if (!after.has(id))
        changes.push({
          kind,
          change: "removed",
          id,
          before: item,
          after: null,
        });
      else if (stable(item) !== stable(after.get(id)))
        changes.push({
          kind,
          change: "changed",
          id,
          before: item,
          after: after.get(id),
        });
    }
    for (const [id, item] of after)
      if (!before.has(id))
        changes.push({ kind, change: "added", id, before: null, after: item });
  }
  return changes;
}

function rowFor(s: ReturnType<typeof currentWorkspaceScope>, id: string) {
  if (!s) return;
  return db
    .prepare(
      "SELECT * FROM bpmn_models WHERE id=? AND tenant_id=? AND organization_id=? AND account_id=?",
    )
    .get(id, s.tenantId, s.organizationId, s.accountId) as
    Record<string, unknown> | undefined;
}
export function createBpmnModelerRouter() {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  const scope = (_req: Request, res: Response): WorkspaceScope | null => {
    const s = currentWorkspaceScope();
    if (!s) {
      res.status(401).json({ error: "authentication_required" });
      return null;
    }
    return s;
  };
  const admin = (req: Request, res: Response): WorkspaceScope | null => {
    const s = scope(req, res);
    if (!s) return null;
    if (s.role !== "admin") {
      res.status(403).json({ error: "admin_required" });
      return null;
    }
    return s;
  };
  const audit = (
    s: WorkspaceScope,
    actor: string,
    model: string,
    event: string,
    detail = "",
  ) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO bpmn_audit VALUES(?,?,?,?,?,?,?,?,?)").run(
      nanoid(),
      s.tenantId,
      s.organizationId,
      s.accountId,
      model,
      actor,
      event,
      detail.slice(0, 1000),
      now,
    );
    recordSecurityEvent({
      userId: actor,
      ...s,
      event: `bpmn_${event}`,
      subject: model,
    });
  };
  r.get("/bpmn-modeler/options", (req, res) => {
    const s = scope(req, res);
    if (!s) return;
    const users = db
      .prepare(
        `SELECT DISTINCT u.id,u.email,u.display_name AS displayName FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0 ORDER BY u.display_name`,
      )
      .all(s.tenantId, s.organizationId, s.accountId);
    const cfg = connectorCredentialConfig(s, "flowable");
    return res.json({
      users,
      roles,
      flowable: {
        configured: Boolean(cfg.baseUrl && cfg.username && cfg.password),
        userMapAvailable: Boolean(cfg.userMap),
        groupMapAvailable: Boolean(cfg.groupMap),
      },
    });
  });
  r.get("/bpmn-models", (req, res) => {
    const s = scope(req, res);
    if (!s) return;
    return res.json(
      db
        .prepare(
          `SELECT m.id,m.key,m.name,m.revision,m.updated_at AS updatedAt,(SELECT MAX(version) FROM bpmn_versions v WHERE v.model_id=m.id) AS latestVersion,(SELECT MAX(version) FROM bpmn_versions v JOIN bpmn_publish p ON p.version_id=v.id AND p.status='published' WHERE v.model_id=m.id) AS publishedVersion FROM bpmn_models m WHERE tenant_id=? AND organization_id=? AND account_id=? ORDER BY updated_at DESC`,
        )
        .all(s.tenantId, s.organizationId, s.accountId),
    );
  });
  r.post("/bpmn-models", (req, res) => {
    const s = admin(req, res);
    if (!s) return;
    if (!req.body || Object.keys(req.body).some((k) => k !== "graph"))
      return res.status(400).json({ error: "unknown_request_field" });
    const v = validate(req.body?.graph);
    if (v.errors.length)
      return res.status(400).json({ error: "invalid_graph", errors: v.errors });
    if (invalidAssignments(s, v.graph))
      return res.status(400).json({ error: "assignment_not_in_scope" });
    const id = nanoid(),
      now = new Date().toISOString(),
      actor = req.authUser!.id;
    try {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO bpmn_models VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          s.tenantId,
          s.organizationId,
          s.accountId,
          v.graph.key,
          v.graph.name,
          JSON.stringify(v.graph),
          1,
          actor,
          actor,
          now,
          now,
        );
        audit(s, actor, id, "create");
      })();
      return res.status(201).json({
        id,
        key: v.graph.key,
        name: v.graph.name,
        revision: 1,
        graph: v.graph,
        updatedAt: now,
      });
    } catch {
      return res.status(409).json({ error: "model_key_conflict" });
    }
  });
  r.get("/bpmn-models/:id", (req, res) => {
    const s = scope(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    return res.json({
      id: m.id,
      key: m.key,
      name: m.name,
      revision: m.revision,
      graph: JSON.parse(String(m.graph)),
      updatedAt: m.updated_at,
    });
  });
  r.put("/bpmn-models/:id", (req, res) => {
    const s = admin(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    const b = req.body ?? {};
    if (Object.keys(b).some((k) => !["expectedRevision", "graph"].includes(k)))
      return res.status(400).json({ error: "unknown_request_field" });
    if (!Number.isInteger(b.expectedRevision))
      return res.status(400).json({ error: "expectedRevision_required" });
    const v = validate(b.graph);
    if (v.errors.length)
      return res.status(400).json({ error: "invalid_graph", errors: v.errors });
    if (invalidAssignments(s, v.graph))
      return res.status(400).json({ error: "assignment_not_in_scope" });
    if (Number(m.revision) !== b.expectedRevision)
      return res.status(409).json({ error: "revision_conflict" });
    const now = new Date().toISOString();
    try {
      const saved = db.transaction(() => {
        const changed = db
          .prepare(
            "UPDATE bpmn_models SET key=?,name=?,graph=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND organization_id=? AND account_id=? AND revision=?",
          )
          .run(
            v.graph.key,
            v.graph.name,
            JSON.stringify(v.graph),
            req.authUser!.id,
            now,
            req.params.id,
            s.tenantId,
            s.organizationId,
            s.accountId,
            b.expectedRevision,
          );
        if (!changed.changes) return false;
        audit(
          s,
          req.authUser!.id,
          req.params.id,
          "update",
          String(b.expectedRevision),
        );
        return true;
      })();
      if (!saved) return res.status(409).json({ error: "revision_conflict" });
    } catch {
      return res.status(409).json({ error: "model_update_conflict" });
    }
    return res.json({
      id: m.id,
      key: v.graph.key,
      name: v.graph.name,
      revision: b.expectedRevision + 1,
      graph: v.graph,
      updatedAt: now,
    });
  });
  r.post("/bpmn-models/:id/validate", (req, res) => {
    const s = scope(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    const v = validate(JSON.parse(String(m.graph)));
    return res.json({
      valid: !v.errors.length,
      errors: v.errors,
      graphHash: sha(JSON.stringify(v.graph)),
    });
  });
  r.post("/bpmn-models/:id/versions", (req, res) => {
    const s = admin(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    if (
      !Number.isInteger(req.body?.expectedRevision) ||
      Number(m.revision) !== req.body.expectedRevision
    )
      return res.status(409).json({ error: "revision_conflict" });
    const v = validate(JSON.parse(String(m.graph)));
    if (v.errors.length)
      return res.status(400).json({ error: "invalid_graph", errors: v.errors });
    let mapped: Graph;
    try {
      mapped = resolveAssignments(s, v.graph);
    } catch (e) {
      return res.status(400).json({
        error: "assignment_mapping_failed",
        message: String((e as Error).message),
      });
    }
    const xml = xmlFor(mapped);
    const xmlErrors = validateGeneratedBpmnXml(xml);
    if (xmlErrors.length)
      return res
        .status(400)
        .json({ error: "unsafe_generated_xml", details: xmlErrors });
    const id = nanoid(),
      now = new Date().toISOString();
    const create = db.transaction(() => {
      const nextRow = db
        .prepare(
          "SELECT COALESCE(MAX(version),0)+1 AS n FROM bpmn_versions WHERE model_id=?",
        )
        .get(m.id) as { n: number };
      const n = Number(nextRow.n);
      db.prepare("INSERT INTO bpmn_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        id,
        s.tenantId,
        s.organizationId,
        s.accountId,
        m.id,
        n,
        JSON.stringify(v.graph),
        xml,
        sha(xml),
        req.authUser!.id,
        now,
      );
      audit(s, req.authUser!.id, String(m.id), "version_created", String(n));
      return n;
    });
    const version = create();
    return res.status(201).json({
      id,
      version,
      graph: v.graph,
      xml,
      sha256: sha(xml),
      createdAt: now,
    });
  });
  r.get("/bpmn-models/:id/versions", (req, res) => {
    const s = scope(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    return res.json(
      db
        .prepare(
          "SELECT id,version,sha256,created_by AS createdBy,created_at AS createdAt FROM bpmn_versions WHERE model_id=? AND tenant_id=? AND organization_id=? AND account_id=? ORDER BY version DESC",
        )
        .all(m.id, s.tenantId, s.organizationId, s.accountId),
    );
  });
  r.post("/bpmn-models/:id/preview", (req, res) => {
    const s = admin(req, res);
    if (!s) return;
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    const v = db
      .prepare(
        "SELECT * FROM bpmn_versions WHERE model_id=? AND version=? AND tenant_id=? AND organization_id=? AND account_id=?",
      )
      .get(
        m.id,
        req.body?.version,
        s.tenantId,
        s.organizationId,
        s.accountId,
      ) as Record<string, unknown> | undefined;
    if (!v) return res.status(404).json({ error: "version_not_found" });
    const cfg = connectorCredentialConfig(s, "flowable");
    let blockedReason = engineReleaseBlocked(cfg)
      ? "真实引擎发布已阻断：尚未独立验证 Flowable 漏洞修复或缓解。本次仅允许临时数据库及 loopback mock 验收。"
      : "";
    try {
      if (
        xmlFor(resolveAssignments(s, JSON.parse(String(v.graph)) as Graph)) !==
        String(v.xml)
      )
        blockedReason = "成员或身份映射已改变，请重新冻结版本。";
    } catch {
      blockedReason = "成员或身份映射不可用，请修正后重新冻结版本。";
    }
    const prev = db
      .prepare(
        "SELECT v.* FROM bpmn_versions v JOIN bpmn_publish p ON p.version_id=v.id AND p.status='published' WHERE v.model_id=? ORDER BY v.version DESC LIMIT 1",
      )
      .get(m.id) as Record<string, unknown> | undefined;
    const token = randomBytes(32).toString("base64url"),
      expires = Date.now() + 300000,
      actor = req.authUser!.id;
    for (const [key, value] of tokens)
      if (value.expires < Date.now()) tokens.delete(key);
    if (tokens.size > 1000)
      return res.status(429).json({ error: "too_many_pending_previews" });
    if (!blockedReason)
      tokens.set(token, {
        scope: scopeKey(s),
        model: String(m.id),
        version: String(v.id),
        hash: String(v.sha256),
        expires,
        actor,
        connectorHash: sha(JSON.stringify(cfg)),
        publishedHash: String(prev?.sha256 ?? ""),
        publishedVersion: String(prev?.id ?? ""),
      });
    const changes = modelChanges(
      prev ? (JSON.parse(String(prev.graph)) as Graph) : undefined,
      JSON.parse(String(v.graph)) as Graph,
    );
    if (
      prev &&
      prev.xml !== v.xml &&
      stable(JSON.parse(String(prev.graph))) ===
        stable(JSON.parse(String(v.graph)))
    )
      changes.push({
        kind: "identitySnapshot",
        change: "changed",
        before: prev.sha256,
        after: v.sha256,
      });
    audit(s, actor, String(m.id), "preview", String(v.version));
    return res.json({
      version: v.version,
      baselineVersion: prev?.version ?? null,
      tenantId: scopeKey(s),
      sha256: v.sha256,
      changes,
      ...(blockedReason
        ? { blocked: true, blockedReason }
        : {
            confirmationToken: token,
            expiresAt: new Date(expires).toISOString(),
          }),
    });
  });
  r.post("/bpmn-models/:id/publish", async (req, res) => {
    const s = admin(req, res);
    if (!s) return;
    const cfg = connectorCredentialConfig(s, "flowable");
    if (engineReleaseBlocked(cfg)) {
      const model = rowFor(s, req.params.id);
      if (!model) return res.status(404).json({ error: "not_found" });
      audit(s, req.authUser!.id, String(model.id), "publish_blocked");
      return res.status(423).json({
        error: "deployment_blocked",
        message:
          "Real Flowable deployments are disabled; release is permitted only in mock-only test mode against loopback.",
      });
    }
    if (
      req.body?.confirm !== true ||
      typeof req.body.confirmationToken !== "string"
    )
      return res.status(400).json({ error: "explicit_confirmation_required" });
    const m = rowFor(s, req.params.id);
    if (!m) return res.status(404).json({ error: "not_found" });
    const t = tokens.get(req.body.confirmationToken);
    tokens.delete(req.body.confirmationToken);
    if (
      !t ||
      t.expires < Date.now() ||
      t.scope !== scopeKey(s) ||
      t.model !== String(m.id) ||
      t.actor !== req.authUser!.id ||
      t.connectorHash !== sha(JSON.stringify(cfg))
    )
      return res.status(409).json({ error: "confirmation_token_invalid" });
    const v = db
      .prepare(
        "SELECT * FROM bpmn_versions WHERE id=? AND model_id=? AND version=? AND tenant_id=? AND organization_id=? AND account_id=?",
      )
      .get(
        t.version,
        m.id,
        req.body.version,
        s.tenantId,
        s.organizationId,
        s.accountId,
      ) as Record<string, unknown> | undefined;
    if (!v || v.sha256 !== t.hash)
      return res.status(409).json({ error: "version_changed" });
    let regenerated: string;
    try {
      regenerated = xmlFor(
        resolveAssignments(s, JSON.parse(String(v.graph)) as Graph),
      );
    } catch {
      return res.status(409).json({ error: "assignment_mapping_changed" });
    }
    if (regenerated !== String(v.xml))
      return res.status(409).json({ error: "assignment_mapping_changed" });
    const xmlErrors = validateGeneratedBpmnXml(String(v.xml));
    if (xmlErrors.length)
      return res
        .status(400)
        .json({ error: "unsafe_generated_xml", details: xmlErrors });
    const pid = nanoid(),
      now = new Date().toISOString();
    let claimed: { error?: string; existing?: Record<string, unknown> };
    try {
      claimed = db
        .transaction(() => {
          const existing = db
            .prepare(
              "SELECT * FROM bpmn_publish WHERE model_id=? AND version_id=?",
            )
            .get(m.id, v.id) as Record<string, unknown> | undefined;
          if (existing) return { existing };
          const previous = db
            .prepare(
              "SELECT v.id,v.sha256,v.version FROM bpmn_versions v JOIN bpmn_publish p ON p.version_id=v.id AND p.status='published' WHERE v.model_id=? ORDER BY v.version DESC LIMIT 1",
            )
            .get(m.id) as
            { id: string; sha256: string; version: number } | undefined;
          if (
            String(previous?.sha256 ?? "") !== t.publishedHash ||
            String(previous?.id ?? "") !== t.publishedVersion
          )
            return { error: "published_baseline_changed" };
          if (previous && Number(v.version) <= previous.version)
            return { error: "older_version_publish_prohibited" };
          if (
            db
              .prepare(
                "SELECT status FROM bpmn_publish WHERE model_id=? AND status IN ('deploying','uncertain')",
              )
              .get(m.id)
          )
            return { error: "model_publication_requires_reconciliation" };
          db.prepare(
            "INSERT INTO bpmn_publish VALUES(?,?,?,?,?,?,?,?,?,?)",
          ).run(
            pid,
            s.tenantId,
            s.organizationId,
            s.accountId,
            m.id,
            v.id,
            "deploying",
            null,
            null,
            now,
          );
          audit(
            s,
            req.authUser!.id,
            String(m.id),
            "publish_started",
            String(v.version),
          );
          return {};
        })
        .immediate();
    } catch {
      return res.status(409).json({ error: "publish_in_progress" });
    }
    if (claimed.existing)
      return res
        .status(claimed.existing.status === "published" ? 200 : 409)
        .json({
          status: claimed.existing.status,
          deploymentId: claimed.existing.deployment_id,
          processDefinitionId: claimed.existing.definition_id,
          ...(claimed.existing.status === "published"
            ? {}
            : { error: "publish_outcome_uncertain" }),
        });
    if (claimed.error)
      return res.status(409).json({
        error: claimed.error,
        message: "请重新预览；若上次发布结果不明确，需先人工对账。",
      });
    try {
      const config = cfg as FlowableConfig;
      const outcome = await deployModelDefinition(
        {
          key: String(JSON.parse(String(v.graph)).key),
          name: String(JSON.parse(String(v.graph)).name),
          xml: String(v.xml),
          tenantId: scopeKey(s),
        },
        config,
      );
      db.transaction(() => {
        db.prepare(
          "UPDATE bpmn_publish SET status='published',deployment_id=?,definition_id=?,updated_at=? WHERE id=? AND status='deploying'",
        ).run(
          outcome.deploymentId,
          outcome.processDefinitionId,
          new Date().toISOString(),
          pid,
        );
        audit(
          s,
          req.authUser!.id,
          String(m.id),
          "published",
          String(v.version),
        );
      })();
      return res.json({ status: "published", version: v.version, ...outcome });
    } catch (e) {
      db.transaction(() => {
        db.prepare(
          "UPDATE bpmn_publish SET status='uncertain',updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), pid);
        audit(
          s,
          req.authUser!.id,
          String(m.id),
          "publish_uncertain",
          String(v.version),
        );
      })();
      return res.status(502).json({
        error: "publish_outcome_uncertain",
        message:
          "Deployment outcome may be ambiguous; automatic retry is prohibited. Reconcile Flowable before further action.",
      });
    }
  });
  return r;
}
