import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/navigation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const nav = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const user = (role) => ({ role, isPlatformAdmin: false });
const full = { sales: true, purchase: true, canManage: true, canWrite: true };

test("all original workbenches remain in grouped navigation and every child has a valid parent", () => {
  const ids = nav.pages.map((page) => page.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    "overview",
    "tasks",
    "projects",
    "timeline",
    "kpi",
    "materials",
    "boms",
    "documents",
    "workflow",
    "reports",
    "report-definitions",
    "report-definitions-new",
    "users",
    "settings",
    "tenants",
  ])
    assert.ok(nav.pageById[id], id);
  for (const page of nav.pages) {
    assert.ok(
      nav.navigationGroups.some((group) => group.id === page.group),
      page.id,
    );
    if (page.parent) {
      assert.ok(nav.pageById[page.parent], page.id);
      assert.equal(nav.pageById[page.parent].group, page.group);
    }
  }
});
test("daily list and form permissions fail closed and follow assigned business lines", () => {
  assert.equal(nav.canAccessPage("daily-sales", user("member"), null), false);
  assert.equal(
    nav.canAccessPage("daily-sales-new", user("reviewer"), {
      ...full,
      canWrite: false,
    }),
    false,
  );
  const purchaseOnly = { ...full, sales: false };
  assert.equal(
    nav.canAccessPage("daily-sales-new", user("member"), purchaseOnly),
    false,
  );
  assert.equal(
    nav.canAccessPage("daily-purchase-new", user("member"), purchaseOnly),
    true,
  );
});
test("daily managers can maintain masters but report definition and delivery writes remain admin-only", () => {
  for (const page of [
    "daily-parties",
    "daily-rates",
    "daily-assignments",
    "daily-mappings",
    "daily-imports",
  ]) {
    assert.equal(nav.canAccessPage(page, user("plm_manager"), full), true);
    assert.equal(nav.canAccessPage(page, user("member"), full), false);
  }
  for (const page of [
    "report-schedules",
    "report-schedules-new",
    "report-schedules-edit",
    "users",
    "settings",
  ]) {
    assert.equal(nav.canAccessPage(page, user("admin"), full), true);
    assert.equal(nav.canAccessPage(page, user("plm_manager"), full), false);
  }
  assert.equal(nav.canAccessPage("reports", user("member"), full), true);
  assert.equal(nav.canAccessPage("report-definitions", user("member"), full), true);
  assert.equal(nav.canAccessPage("report-definitions-new", user("member"), full), false);
  assert.equal(nav.canAccessPage("report-definitions-edit", user("member"), full), false);
  assert.equal(nav.canAccessPage("report-definitions-new", user("admin"), full), true);
  assert.equal(nav.canAccessPage("report-definitions-edit", user("admin"), full), true);
  assert.equal(nav.canAccessPage("tenants", user("admin"), full), false);
  assert.equal(
    nav.canAccessPage(
      "tenants",
      { ...user("admin"), isPlatformAdmin: true },
      full,
    ),
    true,
  );
});
test("display, forms, analysis and master routes resolve to exactly their workbench", () => {
  for (const page of nav.pages) {
    const matches = [
      nav.isDailyWorkbenchPage(page.id),
      nav.isDailyManagementPage(page.id),
      nav.isReportPage(page.id),
      nav.isDailyImportPage(page.id),
    ].filter(Boolean);
    if (["business", "reporting", "masters"].includes(page.group))
      assert.equal(matches.length, 1, page.id);
    else assert.equal(matches.length, 0, page.id);
    assert.equal(nav.resolvePage(page.id), page.id);
  }
  assert.equal(nav.resolvePage("unknown"), "overview");
  assert.equal(nav.resolvePage(null), "overview");
});
