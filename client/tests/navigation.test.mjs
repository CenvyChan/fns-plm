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
  for (const id of ["daily-sales", "daily-purchase", "daily-sales-analysis", "daily-purchase-analysis"]) {
    assert.ok(nav.pageById[id], id);
    assert.equal(nav.pageById[id].parent, undefined);
    assert.equal(nav.pageById[id].kind, id.includes("sales") ? "sales" : "purchase");
  }
  assert.equal(nav.pageById["daily-sales"].label, "销售日报明细");
  assert.equal(nav.pageById["daily-sales-analysis"].label, "销售统计分析");
  assert.equal(nav.pageById["daily-sales"].menuLabel, "日报明细");
  assert.equal(nav.pageById["daily-sales-analysis"].menuLabel, "统计分析");
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
  assert.equal(nav.canAccessPage("daily-sales-analysis", user("member"), purchaseOnly), false);
  assert.equal(nav.canAccessPage("daily-purchase-analysis", user("member"), purchaseOnly), true);
  assert.equal(nav.canAccessPage("daily-sales-analysis", user("member"), full), true);
});

test("the four daily routes remain independent deep-link destinations and menu entries", async () => {
  const { build } = await import("esbuild");
  const compiledAreas = await build({ entryPoints: [new URL("../src/navigation-areas.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node" });
  const { navigationAreas, navigationPath } = await import(`data:text/javascript;base64,${Buffer.from(compiledAreas.outputFiles[0].text).toString("base64")}`);
  const routeIds = ["daily-sales", "daily-sales-analysis", "daily-purchase", "daily-purchase-analysis"];
  assert.deepEqual(routeIds.map((id) => nav.resolvePage(id)), routeIds);
  assert.deepEqual(routeIds.map((id) => nav.pageFromSearch(`?page=${id}`)), routeIds);
  assert.deepEqual(routeIds.map((id) => nav.pageFromSearch(`?page=${id}`, user("member"))), ["overview", "overview", "overview", "overview"]);
  assert.deepEqual(navigationAreas.find((area) => area.id === "daily").sections.filter((section) => ["销售", "采购"].includes(section.label)).map((section) => section.pages), [["daily-sales", "daily-sales-analysis"], ["daily-purchase", "daily-purchase-analysis"]]);
  assert.deepEqual(navigationPath("daily-sales-analysis"), ["经营日报", "销售", "销售统计分析"]);
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
