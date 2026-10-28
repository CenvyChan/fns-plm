import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";

const serverDir = resolve(import.meta.dirname, "..");
let tempDir = "",
  databaseFile = "",
  origin = "",
  child,
  adminToken = "";
const scopes = new Map();
async function allocatePort() {
  const net = await import("node:net"),
    server = net.createServer();
  const port = await new Promise((resolve, reject) =>
    server
      .listen(0, "127.0.0.1", () => resolve(server.address().port))
      .once("error", reject),
  );
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function startServer() {
  const port = await allocatePort();
  origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: "6a".repeat(32),
    APP_ENCRYPTION_KEY_FILE: join(tempDir, "encryption.key"),
    DATA_FILE: join(tempDir, "missing.json"),
    LEGACY_DATA_FILE: join(tempDir, "missing.json"),
    DOCUMENT_STORAGE_DIR: join(tempDir, "documents"),
    INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: "",
    CORS_ORIGIN: "",
    FLOWABLE_BASE_URL: "",
    FLOWABLE_USERNAME: "",
    FLOWABLE_PASSWORD: "",
    K3CLOUD_BASE_URL: "",
    K3CLOUD_ACCOUNT_ID: "",
    K3CLOUD_USERNAME: "",
    K3CLOUD_ORGANIZATION: "",
    K3CLOUD_APP_ID: "",
    K3CLOUD_APP_SECRET: "",
    K3CLOUD_PASSWORD: "",
    K3CLOUD_QUERY_ALLOWLIST: "{}",
    DINGTALK_WEBHOOK_URL: "",
    DINGTALK_ROBOT_WEBHOOK: "",
    DINGTALK_WEBHOOK_SECRET: "",
    DINGTALK_ROBOT_SECRET: "",
    DINGTALK_CARD_CALLBACK_SECRET: "",
    DINGTALK_APP_KEY: "",
    DINGTALK_APP_SECRET: "",
    DINGTALK_USER_MAP_JSON: "{}",
    DINGTALK_SSO_CLIENT_ID: "",
    DINGTALK_SSO_CLIENT_SECRET: "",
    DINGTALK_SSO_CORP_ID: "",
    DINGTALK_SSO_TENANT_ID: "",
    DINGTALK_SSO_ORGANIZATION_ID: "",
    DINGTALK_SSO_ACCOUNT_ID: "",
    CONNECTOR_DEFAULT_TENANT_ID: "",
    CONNECTOR_DEFAULT_ORGANIZATION_ID: "",
    CONNECTOR_DEFAULT_ACCOUNT_ID: "",
  };
  child = spawn(process.execPath, ["dist/index.js"], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderrText = "";
  child.stderr.on("data", (x) => (child.stderrText += x));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw Error(`API exited ${child.exitCode}: ${child.stderrText}`);
    try {
      if (
        (
          await fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(800),
          })
        ).ok
      )
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`API startup timed out: ${child.stderrText}`);
}
async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => child.once("exit", r)),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function api(
  path,
  { method = "GET", body, token = adminToken, scope = true, headers = {} } = {},
) {
  const h = {};
  if (token) {
    h.Authorization = `Bearer ${token}`;
    const s = scope ? scopes.get(token) : null;
    if (s) {
      h["X-Tenant-ID"] = s.tenantId;
      h["X-Organization-ID"] = s.organizationId;
      h["X-Account-ID"] = s.accountId;
    }
  }
  Object.assign(h, headers);
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) h["Content-Type"] = "application/json";
  const response = await fetch(origin + path, {
    method,
    headers: h,
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("spreadsheetml"))
    return {
      response,
      data: null,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}
function csvFile(rows, name = "import.csv") {
  const form = new FormData();
  form.append("file", new Blob([rows], { type: "text/csv" }), name);
  return form;
}
async function preview(type, rows, name) {
  return api(`/api/daily-reports/imports/${type}/preview`, {
    method: "POST",
    body: csvFile(rows, name),
  });
}
const header =
  "业务类型,日期,客户/供应商,单据编号,数量,币种,原币金额,汇率,备注\n";
const row = (
  no,
  {
    type = "sales",
    date = "2026-02-03",
    party = "导入测试客户",
    qty = "2",
    currency = "CNY",
    amount = "125",
    rate = "1",
    note = "集成导入",
  } = {},
) =>
  `${type},${date},${party},${no},${qty},${currency},${amount},${rate},${note}\n`;
async function commit(type, id, extra = {}) {
  return api(`/api/daily-reports/imports/${type}/commit`, {
    method: "POST",
    body: { previewId: id, ...extra },
  });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "momentum-daily-import-"));
  databaseFile = join(tempDir, "isolated.sqlite");
  await startServer();
});
after(async () => {
  await stopServer();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test(
  "daily report imports use durable scoped previews, validate uploads and commit only server preview data",
  { concurrency: false },
  async () => {
    const setup = await api("/api/auth/mobile/setup", {
      method: "POST",
      token: "",
      body: {
        displayName: "导入测试管理员",
        email: "daily-import@example.test",
        password: "test-password-12345",
      },
    });
    assert.equal(setup.response.status, 201, JSON.stringify(setup.data));
    adminToken = setup.data.accessToken;
    scopes.set(adminToken, setup.data.user);
    const master = await api("/api/daily-reporting/masters", {
      method: "POST",
      body: { kind: "customer", name: "导入测试客户" },
    });
    assert.equal(master.response.status, 201, JSON.stringify(master.data));
    const supplier = await api("/api/daily-reporting/masters", {
      method: "POST",
      body: { kind: "supplier", name: "导入测试供应商" },
    });
    assert.equal(supplier.response.status, 201, JSON.stringify(supplier.data));

    // Exercise the actual generated XLSX template and its typed cells/headers.
    const template = await api("/api/daily-reports/imports/sales/template");
    assert.equal(template.response.status, 200);
    assert.match(
      template.response.headers.get("content-type"),
      /spreadsheetml/,
    );
    const templateBook = new ExcelJS.Workbook();
    await templateBook.xlsx.load(template.bytes);
    assert.equal(templateBook.worksheets[0].getCell("A2").value, "sales");
    assert.equal(templateBook.worksheets[0].getCell("B1").value, "日期");
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("导入");
    ws.addRow([
      "业务类型",
      "日期",
      "客户/供应商",
      "单据编号",
      "数量",
      "币种",
      "原币金额",
      "汇率",
      "备注",
    ]);
    ws.addRow([
      "sales",
      new Date("2026-02-03T00:00:00Z"),
      "导入测试客户",
      "XLSX-001",
      2,
      "CNY",
      125,
      1,
      "xlsx测试",
    ]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer()),
      form = new FormData();
    form.append(
      "file",
      new Blob([xlsx], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "sample.xlsx",
    );
    const xlsxPreview = await api("/api/daily-reports/imports/sales/preview", {
      method: "POST",
      body: form,
    });
    assert.equal(
      xlsxPreview.response.status,
      200,
      JSON.stringify(xlsxPreview.data),
    );
    assert.equal(xlsxPreview.data.canCommit, true);
    assert.equal(xlsxPreview.data.rows[0].documentNo, "XLSX-001");
    const xlsxCommit = await commit("sales", xlsxPreview.data.previewId);
    assert.equal(
      xlsxCommit.response.status,
      200,
      JSON.stringify(xlsxCommit.data),
    );
    assert.equal(xlsxCommit.data.inserted, 1);
    assert.equal(
      (await commit("sales", xlsxPreview.data.previewId)).response.status,
      409,
      "preview is consumed and cannot be committed twice",
    );

    const source = row("CSV-001"),
      csvPreview = await preview("sales", header + source);
    assert.equal(
      csvPreview.response.status,
      200,
      JSON.stringify(csvPreview.data),
    );
    assert.equal(csvPreview.data.canCommit, true);
    assert.equal(csvPreview.data.rows[0].partyName, "导入测试客户");
    assert.equal(csvPreview.data.rows[0].amountCny, 125);
    let reports = await api("/api/daily-reports?from=2026-02-03&to=2026-02-03");
    assert.equal(reports.response.status, 200);
    assert.equal(
      reports.data.reports.some((x) => x.documentNo === "CSV-001"),
      false,
      "preview must not persist a report",
    );
    await stopServer();
    await startServer();
    assert.equal(
      (
        await api(`/api/daily-reports/imports/sales/commit`, {
          method: "POST",
          body: { previewId: csvPreview.data.previewId },
        })
      ).response.status,
      200,
      "preview survives API restart",
    );
    const result = await api(
      "/api/daily-reports?from=2026-02-03&to=2026-02-03",
    );
    assert.ok(
      result.data.reports.some(
        (x) => x.documentNo === "CSV-001" && x.source === "history-import",
      ),
    );
    assert.equal(
      (await commit("sales", csvPreview.data.previewId)).response.status,
      409,
    );

    const invalid = await preview(
      "sales",
      header +
        row("BAD-TYPE", { type: "purchase" }) +
        row("BAD-DATE", { date: "2026-99-99" }) +
        row("NAN", { qty: "NaN" }) +
        row("EMPTY", { amount: "" }) +
        row("LONG", {}).replace("LONG", `L${"X".repeat(101)}`),
    );
    assert.equal(invalid.response.status, 200, JSON.stringify(invalid.data));
    assert.equal(invalid.data.canCommit, false);
    assert.ok(invalid.data.errors.some((e) => e.field === "type"));
    assert.ok(invalid.data.errors.some((e) => e.field === "date"));
    assert.ok(invalid.data.errors.some((e) => e.field === "quantity"));
    assert.ok(invalid.data.errors.some((e) => e.field === "originalAmount"));
    assert.ok(invalid.data.errors.some((e) => e.field === "documentNo"));
    assert.equal(
      (await commit("sales", invalid.data.previewId)).response.status,
      409,
      "invalid preview must not commit",
    );
    const malformed = await preview(
      "sales",
      header +
        row("BAD-TRAILING-DATE", { date: "2026-02-03garbage" }) +
        row("BLANK-NUMERIC", { qty: "   " }),
    );
    assert.equal(
      malformed.response.status,
      200,
      JSON.stringify(malformed.data),
    );
    assert.equal(malformed.data.canCommit, false);
    assert.ok(
      malformed.data.errors.some((e) => e.field === "date"),
      "date parser must reject invalid suffixes rather than truncate them",
    );
    assert.ok(
      malformed.data.errors.some((e) => e.field === "quantity"),
      "blank numeric cells must not coerce to zero",
    );
    assert.equal(
      (await commit("sales", malformed.data.previewId)).response.status,
      409,
    );
    const unknownParty = await preview(
      "sales",
      header + row("UNKNOWN-PARTY", { party: "不存在的客商" }),
    );
    assert.equal(
      unknownParty.response.status,
      200,
      JSON.stringify(unknownParty.data),
    );
    assert.equal(
      unknownParty.data.canCommit,
      false,
      "an unmatched master must be a validation error, not a server exception",
    );
    assert.ok(unknownParty.data.errors.some((e) => e.field === "partyName"));
    const duplicates = await preview(
      "sales",
      header + row("DUP-001") + row("DUP-001"),
    );
    assert.equal(duplicates.data.duplicateRows, 1);
    assert.equal(duplicates.data.canCommit, true);
    const duplicateCommit = await commit("sales", duplicates.data.previewId);
    assert.equal(duplicateCommit.response.status, 200);
    assert.equal(duplicateCommit.data.inserted, 1);
    assert.equal(duplicateCommit.data.skipped, 1);
    const conflicting = await preview(
      "sales",
      header +
        row("SAME-NO", { amount: "100" }) +
        row("SAME-NO", { amount: "200" }),
    );
    assert.equal(
      conflicting.response.status,
      200,
      JSON.stringify(conflicting.data),
    );
    assert.equal(
      conflicting.data.canCommit,
      false,
      "same business key with different content is a batch conflict",
    );
    assert.equal(
      (await commit("sales", conflicting.data.previewId)).response.status,
      409,
    );
    const blankNo = await preview(
      "sales",
      header + row("", { amount: "100" }) + row("", { amount: "200" }),
    );
    assert.equal(blankNo.response.status, 200, JSON.stringify(blankNo.data));
    assert.equal(blankNo.data.canCommit, true);
    const blankNoCommit = await commit("sales", blankNo.data.previewId);
    assert.equal(blankNoCommit.response.status, 200);
    assert.equal(
      blankNoCommit.data.inserted,
      2,
      "blank document numbers with distinct content must not collapse into one duplicate",
    );
    const crossType = await commit("purchase", duplicates.data.previewId);
    assert.equal(
      crossType.response.status,
      409,
      "preview is bound to import type",
    );

    const forged = await preview("sales", header + row("SERVER-PAYLOAD"));
    const forgedCommit = await commit("sales", forged.data.previewId, {
      rows: [
        {
          type: "purchase",
          date: "1999-01-01",
          documentNo: "CLIENT-FORGED",
          partyName: "偽造",
          quantity: 999,
          originalAmount: 999,
        },
      ],
      reports: [{ documentNo: "CLIENT-FORGED" }],
      type: "purchase",
    });
    assert.equal(
      forgedCommit.response.status,
      200,
      JSON.stringify(forgedCommit.data),
    );
    assert.equal(forgedCommit.data.inserted, 1);
    reports = await api("/api/daily-reports?from=2026-02-03&to=2026-02-03");
    assert.ok(
      reports.data.reports.some(
        (x) =>
          x.documentNo === "SERVER-PAYLOAD" &&
          x.type === "sales" &&
          x.quantity === 2,
      ),
    );
    assert.ok(
      !reports.data.reports.some((x) => x.documentNo === "CLIENT-FORGED"),
    );

    const pendingScope = await preview("sales", header + row("SCOPE-BOUND"));
    assert.equal(pendingScope.data.canCommit, true);
    assert.equal(
      (await commit("purchase", pendingScope.data.previewId)).response.status,
      409,
    );
    const tenant = await api("/api/auth/tenants", {
      method: "POST",
      body: {
        tenantName: "导入租户B",
        organizationName: "组织B",
        accountName: "账套B",
      },
    });
    assert.equal(tenant.response.status, 201, JSON.stringify(tenant.data));
    const sw = await api("/api/auth/switch-scope", {
      method: "POST",
      body: { accountId: tenant.data.scope.accountId },
    });
    assert.equal(sw.response.status, 200);
    scopes.set(adminToken, sw.data.user);
    assert.equal(
      (await commit("sales", pendingScope.data.previewId)).response.status,
      409,
      "preview cannot cross tenant/organization/account",
    );
    const isolated = await api("/api/daily-reports/imports/sales/preview", {
      method: "POST",
      body: csvFile(header + row("FOREIGN")),
    });
    assert.equal(isolated.response.status, 200);
    assert.equal(
      (
        await api("/api/daily-reports?from=2026-02-03&to=2026-02-03")
      ).data.reports.some((x) => x.documentNo === "SERVER-PAYLOAD"),
      false,
    );

    // Reviewer is authenticated but cannot use administrator-only import endpoints.
    const back = await api("/api/auth/switch-scope", {
      method: "POST",
      body: { accountId: setup.data.user.accountId },
    });
    assert.equal(back.response.status, 200);
    scopes.set(adminToken, back.data.user);
    assert.equal(
      (await commit("sales", pendingScope.data.previewId)).response.status,
      200,
      "foreign scope attempts must not consume the original preview",
    );
    const pendingActor = await preview("sales", header + row("ACTOR-BOUND"));
    const managerInvite = await api("/api/auth/users", {
      method: "POST",
      body: {
        displayName: "日报经理",
        email: "import-manager@example.test",
        role: "plm_manager",
      },
    });
    assert.equal(managerInvite.response.status, 201);
    await api("/api/auth/activate", {
      method: "POST",
      token: "",
      body: {
        token: managerInvite.data.activationToken,
        password: "manager-test-password-123",
      },
    });
    const managerLogin = await api("/api/auth/mobile/login", {
      method: "POST",
      token: "",
      body: {
        email: "import-manager@example.test",
        password: "manager-test-password-123",
        accountId: setup.data.user.accountId,
      },
    });
    assert.equal(managerLogin.response.status, 200);
    scopes.set(managerLogin.data.accessToken, managerLogin.data.user);
    assert.equal(
      (
        await api("/api/daily-reports/imports/sales/commit", {
          method: "POST",
          token: managerLogin.data.accessToken,
          body: { previewId: pendingActor.data.previewId },
        })
      ).response.status,
      409,
      "another authorized manager cannot commit another actor's preview",
    );
    assert.equal(
      (await commit("sales", pendingActor.data.previewId)).response.status,
      200,
    );
    const invite = await api("/api/auth/users", {
      method: "POST",
      body: {
        displayName: "导入只读审核员",
        email: "import-reviewer@example.test",
        role: "reviewer",
      },
    });
    assert.equal(invite.response.status, 201, JSON.stringify(invite.data));
    const activation = await api("/api/auth/activate", {
      method: "POST",
      token: "",
      body: {
        token: invite.data.activationToken,
        password: "reviewer-test-password-123",
      },
    });
    assert.equal(activation.response.status, 200);
    const login = await api("/api/auth/mobile/login", {
      method: "POST",
      token: "",
      body: {
        email: "import-reviewer@example.test",
        password: "reviewer-test-password-123",
        accountId: setup.data.user.accountId,
      },
    });
    assert.equal(login.response.status, 200);
    scopes.set(login.data.accessToken, login.data.user);
    assert.equal(
      (
        await api("/api/daily-reports/imports/sales/preview", {
          method: "POST",
          token: login.data.accessToken,
          body: csvFile(header + row("REVIEWER")),
        })
      ).response.status,
      403,
    );
    assert.equal(
      (
        await api("/api/daily-reports/imports/sales/commit", {
          method: "POST",
          token: login.data.accessToken,
          body: { previewId: isolated.data.previewId },
        })
      ).response.status,
      403,
    );
  },
);

async function legacyPreview(text, defaultType = 'sales') {
  const body = csvFile(text, 'legacy-history.csv');
  if (defaultType) body.append('type', defaultType);
  return api('/api/daily-reports/import/preview', { method: 'POST', body });
}
const legacyCommit = (previewId) => api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId } });

test('840e34a preview/commit contracts reuse historical aliases while retaining current safeguards', { concurrency: false }, async () => {
  const source = 'Report_Date,Party_Name,Bill_No,Quantity,Currency,Amount,Rate,Note\n2026/2/3,导入测试客户,LEGACY-EN-001,2,CNY,125,1,兼容导入\n';
  const p = await legacyPreview(source);
  assert.equal(p.response.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.fileName, 'legacy-history.csv');
  assert.ok(p.data.mappedFields.includes('originalAmount'));
  assert.equal(p.data.errorRows, 0);
  assert.equal(p.data.importableRows, 1);
  assert.equal(p.data.rows[0].line, 2);
  assert.equal(p.data.rows[0].status, 'ready');
  assert.equal(p.data.rows[0].data.date, '2026-02-03');
  assert.deepEqual(p.data.rows[0].errors, []);
  const done = await legacyCommit(p.data.previewId);
  assert.equal(done.response.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.importedCount, 1);
  assert.equal(done.data.skippedDuplicates, 0);
  assert.equal(done.data.imported.length, 1);
  assert.equal(done.data.batchId, p.data.previewId);
  assert.equal((await legacyCommit(p.data.previewId)).response.status, 404);
  const again = await legacyPreview(source);
  assert.equal(again.data.rows[0].status, 'duplicate');
  assert.equal(again.data.rows[0].duplicateReason, 'existing');
  assert.equal((await legacyCommit(again.data.previewId)).data.skippedDuplicates, 1);
  const sameBatch = await legacyPreview(source.replace('LEGACY-EN-001', 'LEGACY-SAME-BATCH') + source.split('\n')[1].replace('LEGACY-EN-001', 'LEGACY-SAME-BATCH') + '\n');
  assert.equal(sameBatch.data.rows[1].duplicateReason, 'same_batch');
  assert.equal(sameBatch.data.duplicateRows, 1);
  const mixed = await legacyPreview('业务类型,日期,客户名称,金额,单号\n销售,2026-02-03,导入测试客户,15,MIXED-S\n采购,2026-02-03,导入测试供应商,25,MIXED-P\n', '');
  assert.equal(mixed.response.status, 200, JSON.stringify(mixed.data));
  assert.equal(mixed.data.errorRows, 0);
  assert.equal((await commit('sales', mixed.data.previewId)).response.status, 409, 'mixed old preview cannot be committed through a fixed business entry');
  const mixedDone = await legacyCommit(mixed.data.previewId);
  assert.equal(mixedDone.data.importedCount, 2);
  assert.deepEqual(mixedDone.data.imported.map(x => x.type).sort(), ['purchase', 'sales']);
  const audits = await api('/api/daily-reports/imports?limit=1&offset=0&type=purchase');
  assert.equal(audits.response.status, 200);
  assert.equal(audits.data.batches[0].id, mixed.data.previewId);
  assert.equal(audits.data.batches[0].type, 'mixed');
  assert.match(audits.data.batches[0].digest, /^[a-f0-9]{64}$/);
  assert.equal(audits.data.batches[0].actorName, '导入测试管理员');
  await stopServer(); await startServer();
  const persisted = await api('/api/daily-reports/imports?limit=500');
  assert.ok(persisted.data.batches.some(x => x.id === done.data.batchId && x.inserted === 1));
  const reports = await api('/api/daily-reports?from=2026-02-03&to=2026-02-03');
  assert.ok(reports.data.reports.some(x => x.documentNo === 'LEGACY-EN-001' && x.importBatchId === done.data.batchId && x.source === 'history-import'));
  const sliced = await api('/api/daily-reports/imports?limit=1&offset=1');
  assert.equal(sliced.data.total, persisted.data.total);
  assert.equal(sliced.data.batches[0].id, persisted.data.batches[1].id);
  assert.equal(sliced.data.hasMore, true);
});

test('both import APIs reject malformed CSV and fail whole batches on validation or races', { concurrency: false }, async () => {
  for (const bad of [
    header + row('QUOTE').replace('集成导入', '坏"引号'),
    header + row('CLOSE').replace('集成导入', '"闭合"x'),
    header + row('OPEN').replace('集成导入\n', '"未闭合'),
  ]) {
    assert.equal((await preview('sales', bad)).response.status, 400);
    assert.equal((await legacyPreview(bad)).response.status, 400);
  }
  const short = await legacyPreview('日期,客户名称,金额\n2026-02-03,导入测试客户\n');
  assert.equal(short.response.status, 200);
  assert.equal(short.data.errorRows, 1);
  assert.match(short.data.rows[0].errors.join(), /字段数不匹配/);
  assert.equal((await legacyCommit(short.data.previewId)).response.status, 422);
  assert.equal((await preview('sales', header + row('LONG-COLS').trimEnd() + ',extra\n')).response.status, 400);
  const invalid = await legacyPreview('日期,客户名称,金额,单号\n2026-02-03,导入测试客户,10,NO-PARTIAL\n2026-99-99,导入测试客户,20,INVALID-DATE\n');
  assert.equal(invalid.data.errorRows, 1);
  assert.equal((await legacyCommit(invalid.data.previewId)).response.status, 422);
  let reports = await api('/api/daily-reports');
  assert.ok(!reports.data.reports.some(x => x.documentNo === 'NO-PARTIAL'));
  const candidate = await legacyPreview('日期,客户名称,金额,单号\n2026-02-03,导入测试客户,10,RACE-KEEP\n2026-02-03,导入测试客户,20,RACE-CONFLICT\n');
  assert.equal(candidate.data.errorRows, 0);
  const competitor = await preview('sales', header + row('RACE-CONFLICT', { amount: '99' }));
  assert.equal((await commit('sales', competitor.data.previewId)).data.inserted, 1);
  const failed = await legacyCommit(candidate.data.previewId);
  assert.equal(failed.response.status, 409);
  assert.equal(failed.data.error, 'import_conflict');
  reports = await api('/api/daily-reports');
  assert.ok(!reports.data.reports.some(x => x.documentNo === 'RACE-KEEP'));
  const conflict = await legacyPreview('日期,客户名称,金额,单号\n2026-02-03,导入测试客户,999,legacy-en-001\n');
  assert.equal(conflict.data.errorRows, 1, 'case-normalized bill key cannot silently skip changed content');
  assert.equal((await legacyCommit(conflict.data.previewId)).response.status, 422);
});

test('legacy previews/audits remain actor and scope bound and do not expand current import RBAC', { concurrency: false }, async () => {
  const original = scopes.get(adminToken);
  const p = await legacyPreview('日期,客户名称,金额,单号\n2026-02-03,导入测试客户,10,LEGACY-SCOPE\n');
  const manager = [...scopes.entries()].find(([, user]) => user.role === 'plm_manager');
  assert.ok(manager);
  assert.equal((await api('/api/daily-reports/import/commit', { method: 'POST', token: manager[0], body: { previewId: p.data.previewId } })).response.status, 404);
  const tenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: '旧契约隔离租户', organizationName: '隔离组织', accountName: '隔离账套' } });
  assert.equal(tenant.response.status, 201);
  const sw = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: tenant.data.scope.accountId } });
  scopes.set(adminToken, sw.data.user);
  assert.equal((await legacyCommit(p.data.previewId)).response.status, 404);
  assert.equal((await api('/api/daily-reports/imports')).data.total, 0);
  const back = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: original.accountId } });
  scopes.set(adminToken, back.data.user);
  assert.equal((await legacyCommit(p.data.previewId)).data.importedCount, 1);
  const reviewer = [...scopes.entries()].find(([, user]) => user.role === 'reviewer');
  assert.ok(reviewer);
  assert.equal((await api('/api/daily-reports/import/preview', { method: 'POST', token: reviewer[0], body: csvFile(header + row('NO-ACCESS')) })).response.status, 403);
  assert.equal((await api('/api/daily-reports/imports', { token: reviewer[0] })).response.status, 403);
});

test('durable audit retains more than 500 completed batches and exposes older pages', { concurrency: false }, async () => {
  const beforeCount = (await api('/api/daily-reports/imports?limit=1')).data.total;
  // Same business content except note would be a conflict: use the exact original record.
  const exact = 'Report_Date,Party_Name,Bill_No,Quantity,Currency,Amount,Rate,Note\n2026/2/3,导入测试客户,LEGACY-EN-001,2,CNY,125,1,兼容导入\n';
  for (let n = 0; n < 501; n++) {
    const p = await legacyPreview(exact);
    assert.equal(p.response.status, 200, `preview ${n}`);
    const result = await legacyCommit(p.data.previewId);
    assert.equal(result.response.status, 200, `commit ${n}: ${JSON.stringify(result.data)}`);
    assert.equal(result.data.skippedDuplicates, 1);
  }
  const first = await api('/api/daily-reports/imports?limit=500');
  assert.equal(first.data.total, beforeCount + 501);
  assert.equal(first.data.batches.length, 500);
  assert.equal(first.data.hasMore, true);
  const remaining = await api('/api/daily-reports/imports?limit=500&offset=500');
  assert.equal(remaining.data.batches.length, beforeCount + 1);
  assert.equal(remaining.data.hasMore, false);
  const ids = [...first.data.batches, ...remaining.data.batches].map(x => x.id);
  assert.equal(new Set(ids).size, beforeCount + 501);
});
