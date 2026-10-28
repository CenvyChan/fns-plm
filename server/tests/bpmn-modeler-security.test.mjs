import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

// Configure an isolated database before importing the module (which initializes its schema).
const temp = mkdtempSync(join(tmpdir(), "plm-bpmn-security-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_FILE = join(temp, "security.sqlite");
process.env.APP_ENCRYPTION_KEY ??= "b4".repeat(32);
process.env.APP_ENCRYPTION_KEY_FILE = join(temp, "key");
process.env.BPMN_MODELER_ALLOW_TEST_MOCK = "true";

const modelerPath = resolve(import.meta.dirname, "../dist/bpmn-modeler.js");
const { validateGeneratedBpmnXml, engineReleaseBlocked, modelChanges } =
  await import(modelerPath);
assert.equal(
  typeof validateGeneratedBpmnXml,
  "function",
  "validator must be exported for direct security testing",
);
after(() => rmSync(temp, { recursive: true, force: true }));

const envelope = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="https://momentum.local/bpmn"><process id="safe" name="Safe" isExecutable="true">${body}</process></definitions>`;
const minimal = envelope(
  '<startEvent id="start"/><userTask id="review"/><endEvent id="end"/><sequenceFlow id="f1" sourceRef="start" targetRef="review"></sequenceFlow><sequenceFlow id="f2" sourceRef="review" targetRef="end"></sequenceFlow>',
);
const rejected = (xml) =>
  assert.ok(
    validateGeneratedBpmnXml(xml).length > 0,
    `expected unsafe XML to be rejected: ${xml}`,
  );

test("accepts a minimal valid generated BPMN document", () => {
  assert.deepEqual(validateGeneratedBpmnXml(minimal), []);
});

test("parallel gateway XML is allowlisted only as a bare BPMN node", () => {
  assert.deepEqual(
    validateGeneratedBpmnXml(envelope('<startEvent id="s"/><parallelGateway id="fork"/><userTask id="u"/><endEvent id="e"/>')),
    [],
  );
  rejected(envelope('<parallelGateway id="fork" flowable:async="true"/>'));
  rejected(envelope('<userTask id="u" flowable:formKey="https://evil.test"/>'));
  assert.deepEqual(
    validateGeneratedBpmnXml(envelope('<startEvent id="s"/><userTask id="u" flowable:formKey="plm-form:approvalForm:v1"/><endEvent id="e"/><sequenceFlow id="f1" sourceRef="s" targetRef="u"></sequenceFlow><sequenceFlow id="f2" sourceRef="u" targetRef="e"></sequenceFlow>')),
    [],
  );
  rejected(envelope('<startEvent id="s"/><userTask id="u" flowable:formKey="plm-form:approvalForm:v0"/><endEvent id="e"/><sequenceFlow id="f1" sourceRef="s" targetRef="u"></sequenceFlow><sequenceFlow id="f2" sourceRef="u" targetRef="e"></sequenceFlow>'));
});

test("rejects XML declarations, external entities, and external URLs", () => {
  rejected(
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]>${envelope("&x;")}`,
  );
  rejected(envelope('<userTask id="u" href="https://evil.example/x"/>'));
  rejected(envelope('<userTask id="u" src="https://evil.example/x"/>'));
  rejected(envelope('<userTask id="u" flowable:class="evil.Class"/>'));
  rejected(envelope('<userTask id="u" href="&#104;ttps://evil.example/x"/>'));
  rejected(envelope('<userTask id="u" href="&#x68;ttps://evil.example/x"/>'));
});

test("rejects dangerous BPMN elements, namespaces, attributes and executable content", () => {
  rejected(envelope('<scriptTask id="s"/>'));
  rejected(envelope('<serviceTask id="s"/>'));
  rejected(envelope('<unknownThing id="x"/>'));
  rejected(envelope('<userTask id="u" unexpected="value"/>'));
  rejected(
    envelope(
      '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://evil.example/x"/>',
    ),
  );
  rejected(envelope('<userTask id="u"><script>alert(1)</script></userTask>'));
  rejected(
    envelope(
      '<userTask id="u"><extensionElements><vendor:payload xmlns:vendor="urn:evil"/></extensionElements></userTask>',
    ),
  );
});

test("rejects malformed XML and comment-obscured unsafe payloads", () => {
  rejected(envelope('<startEvent id="x"></process>'));
  rejected(envelope('<userTask id="u"><broken></userTask>'));
  rejected(
    envelope(
      '<!-- <!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]> --><startEvent id="x"/>',
    ),
  );
  rejected(envelope('<!-- <script>evil()</script> --><startEvent id="x"/>'));
});

test("production/default gate blocks release; test mock is limited to loopback", () => {
  assert.equal(typeof engineReleaseBlocked, "function");
  const oldEnv = {
    node: process.env.NODE_ENV,
    flag: process.env.BPMN_MODELER_ALLOW_TEST_MOCK,
  };
  try {
    process.env.BPMN_MODELER_ALLOW_TEST_MOCK = "true";
    process.env.NODE_ENV = "production";
    assert.equal(
      engineReleaseBlocked({ baseUrl: "http://127.0.0.1:8080" }),
      true,
    );
    process.env.NODE_ENV = "test";
    assert.equal(
      engineReleaseBlocked({ baseUrl: "http://127.0.0.1:8080" }),
      false,
    );
    for (const baseUrl of [
      "http://localhost:8080",
      "http://[::1]:8080",
      "https://127.0.0.1:8443",
    ]) {
      assert.equal(
        engineReleaseBlocked({ baseUrl }),
        false,
        `${baseUrl} should be loopback`,
      );
    }
    for (const baseUrl of [
      "http://example.com",
      "http://192.168.1.2",
      "http://127.0.0.2:8080",
      "not a URL",
    ]) {
      assert.equal(
        engineReleaseBlocked({ baseUrl }),
        true,
        `${baseUrl} must be blocked`,
      );
    }
    delete process.env.BPMN_MODELER_ALLOW_TEST_MOCK;
    assert.equal(
      engineReleaseBlocked({ baseUrl: "http://127.0.0.1:8080" }),
      true,
      "without explicit mock flag release remains blocked",
    );
  } finally {
    process.env.NODE_ENV = oldEnv.node;
    if (oldEnv.flag === undefined)
      delete process.env.BPMN_MODELER_ALLOW_TEST_MOCK;
    else process.env.BPMN_MODELER_ALLOW_TEST_MOCK = oldEnv.flag;
  }
});

test("verified staging release permits only the explicitly configured and allowlisted URL", () => {
  const staging = "http://flowable-stage.example.invalid:18081/flowable-rest/service";
  const old = { node: process.env.NODE_ENV, mock: process.env.BPMN_MODELER_ALLOW_TEST_MOCK, verified: process.env.FLOWABLE_VERIFIED_STAGING_RELEASE, verifiedUrl: process.env.FLOWABLE_VERIFIED_STAGING_URL, allowlist: process.env.FLOWABLE_HTTP_ALLOWLIST };
  try {
    process.env.NODE_ENV = "test";
    delete process.env.BPMN_MODELER_ALLOW_TEST_MOCK;
    process.env.FLOWABLE_VERIFIED_STAGING_RELEASE = "true";
    process.env.FLOWABLE_VERIFIED_STAGING_URL = staging;
    process.env.FLOWABLE_HTTP_ALLOWLIST = staging;
    assert.equal(engineReleaseBlocked({ baseUrl: staging }), false);
    assert.equal(engineReleaseBlocked({ baseUrl: `${staging}/` }), false, "a trailing slash normalizes to the same exact base URL");
    for (const baseUrl of ["http://flowable-stage.example.invalid:18080/flowable-rest/service", "http://flowable-stage.example.invalid:18081/flowable-rest/service/extra", "http://other.example.invalid:18081/flowable-rest/service", "https://flowable-stage.example.invalid:18081/flowable-rest/service"])
      assert.equal(engineReleaseBlocked({ baseUrl }), true, `${baseUrl} must be blocked`);
    process.env.FLOWABLE_VERIFIED_STAGING_RELEASE = "wrong-value";
    assert.equal(engineReleaseBlocked({ baseUrl: staging }), true);
    process.env.FLOWABLE_VERIFIED_STAGING_RELEASE = "true";
    delete process.env.FLOWABLE_VERIFIED_STAGING_RELEASE;
    assert.equal(engineReleaseBlocked({ baseUrl: staging }), true, "NODE_ENV=test alone is not verification proof");
    process.env.FLOWABLE_VERIFIED_STAGING_RELEASE = "true";
    delete process.env.FLOWABLE_HTTP_ALLOWLIST;
    assert.equal(engineReleaseBlocked({ baseUrl: staging }), true, "verified staging URL must also be in the exact allowlist");
  } finally {
    process.env.NODE_ENV = old.node;
    if (old.mock === undefined) delete process.env.BPMN_MODELER_ALLOW_TEST_MOCK; else process.env.BPMN_MODELER_ALLOW_TEST_MOCK = old.mock;
    if (old.verified === undefined) delete process.env.FLOWABLE_VERIFIED_STAGING_RELEASE; else process.env.FLOWABLE_VERIFIED_STAGING_RELEASE = old.verified;
    if (old.verifiedUrl === undefined) delete process.env.FLOWABLE_VERIFIED_STAGING_URL; else process.env.FLOWABLE_VERIFIED_STAGING_URL = old.verifiedUrl;
    if (old.allowlist === undefined) delete process.env.FLOWABLE_HTTP_ALLOWLIST; else process.env.FLOWABLE_HTTP_ALLOWLIST = old.allowlist;
  }
});

test("diff includes changed process, assignment, layout, conditions, added and removed nodes and flows", () => {
  const previous = {
    key: "p",
    name: "Before",
    nodes: [
      {
        id: "review",
        type: "userTask",
        name: "Review",
        assignment: { kind: "assignee", userIds: ["one"] },
        x: 1,
        y: 1,
      },
      { id: "removed", type: "endEvent", name: "Old" },
    ],
    flows: [
      { id: "f", source: "review", target: "removed", condition: "approved" },
      { id: "removedFlow", source: "review", target: "removed" },
    ],
  };
  const next = {
    key: "p",
    name: "After",
    nodes: [
      {
        ...previous.nodes[0],
        assignment: { kind: "candidateRole", role: "reviewer" },
        x: 2,
      },
      { id: "added", type: "endEvent", name: "New" },
    ],
    flows: [
      { id: "f", source: "review", target: "added", isDefault: true },
      { id: "addedFlow", source: "review", target: "added" },
    ],
  };
  const changes = modelChanges(previous, next);
  for (const [kind, change, id] of [
    ["process", "changed", undefined],
    ["node", "changed", "review"],
    ["node", "removed", "removed"],
    ["node", "added", "added"],
    ["flow", "changed", "f"],
    ["flow", "removed", "removedFlow"],
    ["flow", "added", "addedFlow"],
  ])
    assert.ok(
      changes.some(
        (c) => c.kind === kind && c.change === change && c.id === id,
      ),
      `${kind}/${change}/${id}`,
    );
  assert.deepEqual(modelChanges(next, structuredClone(next)), []);
});

test("candidateGroups accepts only scoped deterministic role IDs", async () => {
  const { validateGeneratedBpmnXml } = await import("../dist/bpmn-xml.js");
  const base = `<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="https://momentum.local/bpmn"><process id="p" name="P" isExecutable="true"><startEvent id="s"/><userTask id="t" name="T" flowable:candidateGroups="plm_${"a".repeat(32)}_r_reviewer"/><endEvent id="e"/><sequenceFlow id="f1" sourceRef="s" targetRef="t"></sequenceFlow><sequenceFlow id="f2" sourceRef="t" targetRef="e"></sequenceFlow></process></definitions>`;
  assert.deepEqual(validateGeneratedBpmnXml(base), []);
  for (const bad of ["admin", "plm_"+"a".repeat(32)+"_r_admin,plm_"+"b".repeat(32)+"_r_member", "plm_"+"a".repeat(32)+"_r_owner"])
    assert.ok(validateGeneratedBpmnXml(base.replace(/plm_[a-f0-9]{32}_r_reviewer/, bad)).length);
});
