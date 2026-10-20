import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

const dir = resolve(import.meta.dirname, "..");
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));

test("BPMN isolated HTTP lifecycle, persistence, authorization, XML boundaries and mock deployment", async () => {
  const temp = mkdtempSync(join(tmpdir(), "plm-bpmn-test-"));
  const databaseFile = join(temp, "test.sqlite");
  const deployments = [];
  let failDeploy = false;
  const mock = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/repository/deployments") {
      deployments.push({ body, auth: req.headers.authorization });
      if (failDeploy) {
        req.socket.destroy();
        return;
      }
      res.end(JSON.stringify({ id: `mock-deployment-${deployments.length}` }));
      return;
    }
    if (req.url.startsWith("/repository/process-definitions")) {
      const key =
        new URL(req.url, "http://localhost").searchParams.get("key") ||
        "safeApproval";
      res.end(
        JSON.stringify({
          data: [
            {
              id: `${key}:1:mock`,
              key,
              deploymentId: `mock-deployment-${deployments.length}`,
            },
          ],
        }),
      );
      return;
    }
    res.end(JSON.stringify({ data: [] }));
  });
  const mockPort = await listen(mock);
  const reserved = createServer();
  const port = await listen(reserved);
  await close(reserved);
  const origin = `http://127.0.0.1:${port}`;
  let child, token, scope;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: "a3".repeat(32),
    APP_ENCRYPTION_KEY_FILE: join(temp, "key"),
    DATA_FILE: join(temp, "missing.json"),
    LEGACY_DATA_FILE: join(temp, "missing.json"),
    DOCUMENT_STORAGE_DIR: join(temp, "docs"),
    INTEGRATION_DATA_DIR: temp,
    REDIS_URL: "",
    FLOWABLE_BASE_URL: "",
    FLOWABLE_USERNAME: "",
    FLOWABLE_PASSWORD: "",
    CONNECTOR_DEFAULT_TENANT_ID: "",
    CONNECTOR_DEFAULT_ORGANIZATION_ID: "",
    CONNECTOR_DEFAULT_ACCOUNT_ID: "",
    DINGTALK_SSO_CLIENT_ID: "",
    DINGTALK_SSO_CLIENT_SECRET: "",
    DINGTALK_SSO_CORP_ID: "",
    DINGTALK_SSO_TENANT_ID: "",
    DINGTALK_SSO_ORGANIZATION_ID: "",
    DINGTALK_SSO_ACCOUNT_ID: "",
    BPMN_MODELER_ALLOW_TEST_MOCK: "true",
  };
  async function start() {
    child = spawn(process.execPath, ["dist/index.js"], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    child.stdout.resume();
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw Error(stderr);
      try {
        if ((await fetch(origin + "/api/health")).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("test server startup timeout: " + stderr);
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const ended = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await ended;
    }
  }
  const evidence = [];
  async function api(path, method = "GET", body, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (options.auth !== false && token) {
      headers.Authorization = `Bearer ${options.token || token}`;
      const s = options.scope || scope;
      Object.assign(headers, {
        "X-Tenant-ID": s.tenantId,
        "X-Organization-ID": s.organizationId,
        "X-Account-ID": s.accountId,
      });
    }
    Object.assign(headers, options.headers);
    const res = await fetch(origin + "/api" + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json();
    evidence.push({ method, path, status: res.status });
    return { status: res.status, data };
  }
  const ok = (result, status = 200) => {
    assert.equal(result.status, status, JSON.stringify(result.data));
    return result.data;
  };
  try {
    await start();
    assert.equal(
      (await api("/bpmn-models", "GET", undefined, { auth: false })).status,
      401,
    );
    const setup = ok(
      await api(
        "/auth/mobile/setup",
        "POST",
        {
          displayName: "BPMN Test Admin",
          email: "bpmn-admin@example.test",
          password: "isolated-test-password-123",
        },
        { auth: false },
      ),
      201,
    );
    token = setup.accessToken;
    scope = setup.user;
    const originalScope = { ...scope };
    const graph = {
      key: "safeApproval",
      name: "隔离审批",
      nodes: [
        { id: "Start", type: "startEvent", name: "开始", x: 100, y: 150 },
        {
          id: "Review",
          type: "userTask",
          name: "管理员审核",
          assignment: { kind: "assignee", userIds: [scope.id] },
          x: 230,
          y: 130,
        },
        { id: "End", type: "endEvent", name: "结束", x: 430, y: 150 },
      ],
      flows: [
        { id: "Flow1", source: "Start", target: "Review" },
        { id: "Flow2", source: "Review", target: "End" },
      ],
    };
    const options = ok(await api("/bpmn-modeler/options"));
    assert.ok(options.users.some((u) => u.id === scope.id));
    assert.equal(
      (await api("/bpmn-models", "POST", { graph, xml: "<!DOCTYPE x>" }))
        .status,
      400,
    );
    for (const unsafe of [
      { ...graph, nodes: [null, ...graph.nodes] },
      { ...graph, flows: [null, ...graph.flows] },
      { ...graph, key: "Start" },
      { ...graph, name: "bad\u0000name" },
      {
        ...graph,
        flows: [
          ...graph.flows,
          { id: "BadProcessEdge", source: graph.key, target: "End" },
        ],
      },
      {
        ...graph,
        xml: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>',
      },
      {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === "Review" ? { ...n, type: "scriptTask", script: "evil" } : n,
        ),
      },
      {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === "Review"
            ? { ...n, type: "serviceTask", url: "https://evil.test" }
            : n,
        ),
      },
      {
        ...graph,
        flows: graph.flows.map((f) => ({
          ...f,
          conditionExpression: "${evil()}",
        })),
      },
      {
        ...graph,
        nodes: [
          ...graph.nodes,
          { id: "Detached", type: "endEvent", name: "孤立" },
        ],
      },
      {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === "Review"
            ? {
                ...n,
                assignment: { kind: "assignee", userIds: ["foreign-user"] },
              }
            : n,
        ),
      },
    ])
      assert.equal(
        (await api("/bpmn-models", "POST", { graph: unsafe })).status,
        400,
      );
    const created = ok(await api("/bpmn-models", "POST", { graph }), 201);
    const id = created.id;
    const path = "/bpmn-models/" + id;
    assert.equal(created.revision, 1);
    assert.equal(
      (await api(path, "PUT", { expectedRevision: 0, graph })).status,
      409,
    );
    const saved = ok(
      await api(path, "PUT", {
        expectedRevision: 1,
        graph: { ...graph, name: "隔离审批 V2" },
      }),
    );
    assert.equal(saved.revision, 2);
    assert.equal(ok(await api(path + "/validate", "POST", {})).valid, true);
    // Identity mappings must be explicitly configured through the existing scoped connector.
    ok(
      await api("/integrations/settings/flowable", "PUT", {
        baseUrl: `http://127.0.0.1:${mockPort}`,
        username: "mock-user",
        password: "mock-password",
        userMap: { "bpmn-admin@example.test": "engine-admin" },
      }),
    );
    const frozen = ok(
      await api(path + "/versions", "POST", { expectedRevision: 2 }),
      201,
    );
    assert.equal(frozen.version, 1);
    assert.match(frozen.xml, /flowable:assignee="engine-admin"/);
    const sha = frozen.sha256;
    await stop();
    await start();
    assert.equal(
      ok(await api(path)).revision,
      2,
      "draft survives process restart",
    );
    assert.equal(
      ok(await api(path + "/versions"))[0].sha256,
      sha,
      "immutable version survives restart",
    );
    const preview = ok(await api(path + "/preview", "POST", { version: 1 }));
    assert.ok(preview.confirmationToken);
    assert.ok(preview.changes.length);
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 1,
          confirmationToken: preview.confirmationToken,
          confirm: false,
        })
      ).status,
      400,
    );
    const publish = ok(
      await api(path + "/publish", "POST", {
        version: 1,
        confirmationToken: preview.confirmationToken,
        confirm: true,
      }),
    );
    assert.equal(deployments.length, 1);
    assert.match(
      deployments[0].body,
      new RegExp(
        `tenant:${scope.tenantId}:organization:${scope.organizationId}:account:${scope.accountId}`,
      ),
    );
    assert.match(deployments[0].body, /safeApproval/);
    assert.ok(deployments[0].auth.startsWith("Basic "));
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 1,
          confirmationToken: preview.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
    );
    const previewAgain = ok(
      await api(path + "/preview", "POST", { version: 1 }),
    );
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 1,
          confirmationToken: previewAgain.confirmationToken,
          confirm: true,
        })
      ).status,
      200,
    );
    assert.equal(
      deployments.length,
      1,
      "duplicate publication does not increment engine version",
    );
    // A remote address is never contacted, even in test mode; both preview and publish are blocked.
    const connector = {
      baseUrl: `http://127.0.0.1:${mockPort}`,
      username: "mock-user",
      password: "mock-password",
      userMap: { "bpmn-admin@example.test": "engine-admin" },
    };
    ok(
      await api("/integrations/settings/flowable", "PUT", {
        ...connector,
        baseUrl: "https://never-contact.example.test",
      }),
    );
    const blocked = ok(await api(path + "/preview", "POST", { version: 1 }));
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.confirmationToken, undefined);
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 1,
          confirmationToken: "forged",
          confirm: true,
        })
      ).status,
      423,
    );
    assert.equal(deployments.length, 1);
    ok(await api("/integrations/settings/flowable", "PUT", connector));
    const staleMapping = ok(
      await api(path + "/preview", "POST", { version: 1 }),
    );
    ok(
      await api("/integrations/settings/flowable", "PUT", {
        ...connector,
        userMap: { "bpmn-admin@example.test": "changed-engine-user" },
      }),
    );
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 1,
          confirmationToken: staleMapping.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal(
      ok(await api(path + "/preview", "POST", { version: 1 })).blocked,
      true,
    );
    ok(await api("/integrations/settings/flowable", "PUT", connector));
    const branched = {
      ...graph,
      name: "角色与排他分支",
      nodes: [
        graph.nodes[0],
        {
          ...graph.nodes[1],
          assignment: { kind: "candidateRole", role: "admin" },
        },
        { id: "Decision", type: "exclusiveGateway", name: "决定" },
        graph.nodes[2],
        { id: "RejectedEnd", type: "endEvent", name: "驳回结束" },
      ],
      flows: [
        graph.flows[0],
        { id: "ToDecision", source: "Review", target: "Decision" },
        {
          id: "ApprovedFlow",
          source: "Decision",
          target: "End",
          condition: "approved",
        },
        {
          id: "DefaultFlow",
          source: "Decision",
          target: "RejectedEnd",
          isDefault: true,
        },
      ],
    };
    ok(await api(path, "PUT", { expectedRevision: 2, graph: branched }));
    const v2 = ok(
      await api(path + "/versions", "POST", { expectedRevision: 3 }),
      201,
    );
    assert.match(v2.xml, /flowable:candidateUsers="engine-admin"/);
    assert.match(
      v2.xml,
      /exclusiveGateway id="Decision" default="DefaultFlow"/,
    );
    assert.match(v2.xml, /\$\{approvalDecision == 'approved'\}/);
    assert.equal((v2.xml.match(/id="Decision"/g) || []).length, 1);
    const p2 = ok(await api(path + "/preview", "POST", { version: 2 }));
    assert.equal(p2.baselineVersion, 1);
    assert.ok(
      p2.changes.some((c) => c.kind === "process" && c.change === "changed"),
    );
    assert.ok(
      p2.changes.some(
        (c) => c.kind === "node" && c.id === "Review" && c.change === "changed",
      ),
    );
    assert.ok(
      p2.changes.some(
        (c) => c.kind === "flow" && c.id === "Flow2" && c.change === "removed",
      ),
    );
    const p2b = ok(await api(path + "/preview", "POST", { version: 2 }));
    const oldFrozen = sha;
    ok(
      await api(path, "PUT", {
        expectedRevision: 3,
        graph: { ...branched, name: "网络不明确测试" },
      }),
    );
    const v3 = ok(
      await api(path + "/versions", "POST", { expectedRevision: 4 }),
      201,
    );
    assert.equal(v3.version, 3);
    const staleBaseline = ok(
      await api(path + "/preview", "POST", { version: 3 }),
    );
    const parallel = await Promise.all([
      api(path + "/publish", "POST", {
        version: 2,
        confirmationToken: p2.confirmationToken,
        confirm: true,
      }),
      api(path + "/publish", "POST", {
        version: 2,
        confirmationToken: p2b.confirmationToken,
        confirm: true,
      }),
    ]);
    assert.ok(parallel.some((r) => r.status === 200));
    assert.equal(
      deployments.length,
      2,
      "concurrent publication sends only one deployment",
    );
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 3,
          confirmationToken: staleBaseline.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
      "publishing a different version invalidates a previously approved baseline",
    );
    const p3 = ok(await api(path + "/preview", "POST", { version: 3 }));
    failDeploy = true;
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 3,
          confirmationToken: p3.confirmationToken,
          confirm: true,
        })
      ).status,
      502,
    );
    failDeploy = false;
    const retry = ok(await api(path + "/preview", "POST", { version: 3 }));
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 3,
          confirmationToken: retry.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal(
      deployments.length,
      3,
      "uncertain outcome is never automatically retried",
    );
    ok(
      await api(path, "PUT", {
        expectedRevision: 4,
        graph: { ...branched, name: "不得绕过对账" },
      }),
    );
    ok(await api(path + "/versions", "POST", { expectedRevision: 5 }), 201);
    const p4 = ok(await api(path + "/preview", "POST", { version: 4 }));
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 4,
          confirmationToken: p4.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
      "a new version cannot bypass model-level uncertain publication",
    );
    assert.equal(deployments.length, 3);
    await stop();
    await start();
    assert.equal(
      ok(await api(path + "/versions")).find((v) => v.version === 1).sha256,
      oldFrozen,
    );
    const restartedRetry = ok(
      await api(path + "/preview", "POST", { version: 3 }),
    );
    assert.equal(
      (
        await api(path + "/publish", "POST", {
          version: 3,
          confirmationToken: restartedRetry.confirmationToken,
          confirm: true,
        })
      ).status,
      409,
      "uncertain survives process restart",
    );
    const tenant = ok(
      await api("/auth/tenants", "POST", {
        tenantName: "BPMN Other",
        organizationName: "Other Org",
        accountName: "Other Account",
      }),
      201,
    );
    scope = ok(
      await api("/auth/switch-scope", "POST", {
        accountId: tenant.scope.accountId,
      }),
    ).user;
    assert.equal((await api(path)).status, 404);
    assert.equal((await api(path + "/versions")).status, 404);
    assert.deepEqual(ok(await api("/bpmn-models")), []);
    assert.ok(
      !ok(await api("/bpmn-modeler/options")).users.some(
        (u) => u.id === "foreign-user",
      ),
    );
    scope = ok(
      await api("/auth/switch-scope", "POST", {
        accountId: originalScope.accountId,
      }),
    ).user;
    assert.equal(
      (
        await api(path, "GET", undefined, {
          headers: { "X-Account-ID": tenant.scope.accountId },
        })
      ).status,
      403,
    );
    const member = ok(
      await api("/auth/users", "POST", {
        displayName: "BPMN Member",
        email: "bpmn-member@example.test",
        role: "member",
      }),
      201,
    );
    ok(
      await api(
        "/auth/activate",
        "POST",
        {
          token: member.activationToken,
          password: "member-isolated-password-123",
        },
        { auth: false },
      ),
    );
    const login = ok(
      await api(
        "/auth/mobile/login",
        "POST",
        {
          email: "bpmn-member@example.test",
          password: "member-isolated-password-123",
        },
        { auth: false },
      ),
    );
    for (const [p, m, b] of [
      ["/bpmn-models", "POST", { graph }],
      [path, "PUT", { expectedRevision: 2, graph }],
      [path + "/versions", "POST", { expectedRevision: 2 }],
      [
        path + "/publish",
        "POST",
        { version: 1, confirmationToken: "forged", confirm: true },
      ],
    ])
      assert.equal(
        (await api(p, m, b, { token: login.accessToken, scope: login.user }))
          .status,
        403,
      );
    const db = new Database(databaseFile, { readonly: true });
    const modelRow = db
      .prepare(
        "SELECT id,revision,tenant_id,organization_id,account_id FROM bpmn_models WHERE id=?",
      )
      .get(id);
    const versionRows = db
      .prepare("SELECT version,sha256 FROM bpmn_versions WHERE model_id=?")
      .all(id);
    const audit = db
      .prepare("SELECT event,actor_id FROM bpmn_audit WHERE model_id=?")
      .all(id);
    const published = db
      .prepare("SELECT status,deployment_id FROM bpmn_publish WHERE model_id=?")
      .all(id);
    assert.equal(modelRow.revision, 5);
    assert.equal(versionRows.length, 4);
    assert.ok(audit.length >= 4);
    assert.equal(published.filter((p) => p.status === "published").length, 2);
    assert.equal(published.filter((p) => p.status === "uncertain").length, 1);
    assert.equal(versionRows.find((v) => v.version === 1).sha256, sha);
    db.close();
    const writable = new Database(databaseFile);
    assert.throws(
      () =>
        writable
          .prepare("UPDATE bpmn_versions SET xml='tampered' WHERE model_id=?")
          .run(id),
      /immutable BPMN version/,
    );
    assert.throws(
      () =>
        writable.prepare("DELETE FROM bpmn_versions WHERE model_id=?").run(id),
      /immutable BPMN version/,
    );
    assert.throws(
      () =>
        writable
          .prepare("UPDATE bpmn_audit SET event='tampered' WHERE model_id=?")
          .run(id),
      /immutable BPMN audit/,
    );
    assert.throws(
      () => writable.prepare("DELETE FROM bpmn_audit WHERE model_id=?").run(id),
      /immutable BPMN audit/,
    );
    writable.close();
    const out = resolve(dir, "../qa-evidence/bpmn-modeler");
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "http-persistence-evidence.json"),
      JSON.stringify(
        {
          isolation: "temporary SQLite + loopback HTTP mock only",
          model: modelRow,
          versions: versionRows,
          audit,
          published,
          deployments: deployments.length,
          requests: evidence,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await stop();
    await close(mock);
    rmSync(temp, { recursive: true, force: true });
  }
});
