import type { AuthUser } from "./api";

export type NavigationGroup =
  "workspace" | "product" | "business" | "reporting" | "masters" | "system";
export type DailyAccess = {
  sales: boolean;
  purchase: boolean;
  canManage: boolean;
  canWrite: boolean;
};
export type PageDefinition = {
  id: string;
  label: string;
  menuLabel?: string;
  group: NavigationGroup;
  icon: string;
  parent?: string;
  manager?: boolean;
  admin?: boolean;
  platform?: boolean;
  kind?: "sales" | "purchase";
  writer?: boolean;
};
export const navigationGroups: { id: NavigationGroup; label: string }[] = [
  { id: "workspace", label: "工作台" },
  { id: "product", label: "产品与项目" },
  { id: "business", label: "经营日报" },
  { id: "reporting", label: "分析与报表" },
  { id: "masters", label: "日报基础资料" },
  { id: "system", label: "系统管理" },
];
export const pages: PageDefinition[] = [
  { id: "overview", label: "总览", group: "workspace", icon: "dashboard" },
  { id: "tasks", label: "我的待办", group: "workspace", icon: "tasks" },
  { id: "timeline", label: "时间线", group: "workspace", icon: "calendar" },
  { id: "projects", label: "项目进度", group: "product", icon: "projects" },
  { id: "materials", label: "物料主数据", group: "product", icon: "boxes" },
  { id: "boms", label: "多视图 BOM", group: "product", icon: "branch" },
  { id: "documents", label: "图文档中心", group: "product", icon: "file" },
  { id: "workflow", label: "流程审批", group: "product", icon: "check" },
  { id: "kpi", label: "KPI 与绩效", group: "product", icon: "chart" },
  {
    id: "daily-sales",
    label: "销售日报明细",
    menuLabel: "日报明细",
    group: "business",
    icon: "file",
    kind: "sales",
  },
  {
    id: "daily-purchase",
    label: "采购日报明细",
    menuLabel: "日报明细",
    group: "business",
    icon: "file",
    kind: "purchase",
  },
  {
    id: "daily-sales-analysis",
    label: "销售统计分析",
    menuLabel: "统计分析",
    group: "business",
    icon: "chart",
    kind: "sales",
  },
  {
    id: "daily-purchase-analysis",
    label: "采购统计分析",
    menuLabel: "统计分析",
    group: "business",
    icon: "chart",
    kind: "purchase",
  },
  {
    id: "daily-sales-new",
    label: "新增销售日报",
    group: "business",
    icon: "file",
    kind: "sales",
    writer: true,
    parent: "daily-sales",
  },
  {
    id: "daily-purchase-new",
    label: "新增采购日报",
    group: "business",
    icon: "file",
    kind: "purchase",
    writer: true,
    parent: "daily-purchase",
  },
  {
    id: "daily-sales-edit",
    label: "编辑销售日报",
    group: "business",
    icon: "file",
    kind: "sales",
    writer: true,
    parent: "daily-sales",
  },
  {
    id: "daily-purchase-edit",
    label: "编辑采购日报",
    group: "business",
    icon: "file",
    kind: "purchase",
    writer: true,
    parent: "daily-purchase",
  },
  {
    id: "daily-sales-import",
    label: "导入往期销售日报",
    group: "business",
    icon: "file",
    kind: "sales",
    manager: true,
    parent: "daily-sales",
  },
  {
    id: "daily-purchase-import",
    label: "导入往期采购日报",
    group: "business",
    icon: "file",
    kind: "purchase",
    manager: true,
    parent: "daily-purchase",
  },
  {
    id: "daily-reconciliation",
    label: "数据核对与关联",
    group: "reporting",
    icon: "activity",
  },
  {
    id: "daily-documents",
    label: "K3 业务单据",
    group: "reporting",
    icon: "boxes",
  },
  {
    id: "daily-archives",
    label: "日报快照与更正",
    group: "reporting",
    icon: "archive",
  },
  { id: "reports", label: "报告展示", group: "reporting", icon: "chart" },
  {
    id: "report-definitions",
    label: "报表定义",
    group: "reporting",
    icon: "file",
  },
  {
    id: "report-definitions-new",
    label: "新增报表定义",
    group: "reporting",
    icon: "file",
    admin: true,
    parent: "report-definitions",
  },
  {
    id: "report-definitions-edit",
    label: "编辑报表定义",
    group: "reporting",
    icon: "file",
    admin: true,
    parent: "report-definitions",
  },
  {
    id: "report-schedules",
    label: "报表发送计划",
    group: "reporting",
    icon: "calendar",
    admin: true,
  },
  {
    id: "report-schedules-new",
    label: "新增发送计划",
    group: "reporting",
    icon: "calendar",
    admin: true,
    parent: "report-schedules",
  },
  {
    id: "report-schedules-edit",
    label: "编辑发送计划",
    group: "reporting",
    icon: "calendar",
    admin: true,
    parent: "report-schedules",
  },
  {
    id: "daily-parties",
    label: "客户与供应商",
    group: "masters",
    icon: "users",
    manager: true,
  },
  {
    id: "daily-parties-new",
    label: "新增客商主档",
    group: "masters",
    icon: "users",
    manager: true,
    parent: "daily-parties",
  },
  {
    id: "daily-parties-edit",
    label: "编辑客商主档",
    group: "masters",
    icon: "users",
    manager: true,
    parent: "daily-parties",
  },
  {
    id: "daily-rates",
    label: "月汇率",
    group: "masters",
    icon: "activity",
    manager: true,
  },
  {
    id: "daily-rates-new",
    label: "维护月汇率",
    group: "masters",
    icon: "activity",
    manager: true,
    parent: "daily-rates",
  },
  {
    id: "daily-assignments",
    label: "人员归属",
    group: "masters",
    icon: "users",
    manager: true,
  },
  {
    id: "daily-mappings",
    label: "K3 客商映射",
    group: "masters",
    icon: "branch",
    manager: true,
  },
  {
    id: "daily-imports",
    label: "历史导入记录",
    group: "masters",
    icon: "archive",
    manager: true,
  },
  {
    id: "users",
    label: "成员与权限",
    group: "system",
    icon: "users",
    admin: true,
  },
  {
    id: "settings",
    label: "系统集成",
    group: "system",
    icon: "settings",
    admin: true,
  },
  {
    id: "tenants",
    label: "租户与账套",
    group: "system",
    icon: "building",
    platform: true,
  },
];
export const pageById = Object.fromEntries(
  pages.map((page) => [page.id, page]),
) as Record<string, PageDefinition>;
export const resolvePage = (value: string | null) =>
  value && pageById[value] ? value : "overview";
export const pageFromLocation = () =>
  resolvePage(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("page"),
  );
export const isDailyImportPage = (page: string) =>
  page === "daily-sales-import" || page === "daily-purchase-import";
export const isDailyWorkbenchPage = (page: string) =>
  (pageById[page]?.group === "business" && !isDailyImportPage(page)) ||
  ["daily-reconciliation", "daily-documents", "daily-archives"].includes(page);
export const isDailyManagementPage = (page: string) =>
  pageById[page]?.group === "masters";
export const isReportPage = (page: string) =>
  page === "reports" ||
  page === "report-definitions" ||
  page === "report-definitions-new" ||
  page === "report-definitions-edit" ||
  page.startsWith("report-schedules");
export function canAccessPage(
  page: string,
  user: AuthUser,
  access: DailyAccess | null,
): boolean {
  const item = pageById[page];
  if (!item) return false;
  if (item.platform && !user.isPlatformAdmin) return false;
  if (item.admin && user.role !== "admin") return false;
  if (item.manager && user.role !== "admin" && user.role !== "plm_manager")
    return false;
  if (item.kind && !access?.[item.kind]) return false;
  if (item.writer && !access?.canWrite) return false;
  return true;
}

// Compatibility API retained for the production BusinessNavigation component.
export type NavigationUser = Pick<AuthUser, "role" | "isPlatformAdmin">;
export type NavigationItem = { id: string; label: string; access?: "admin" | "platform" };
export function canAccessNavigation(item: NavigationItem, user: NavigationUser): boolean {
  if (item.access === "platform") return Boolean(user.isPlatformAdmin);
  if (item.access === "admin") return user.role === "admin" || user.isPlatformAdmin;
  return true;
}
export function visibleNavigation(user: NavigationUser) {
  return navigationGroups.map(group => ({ ...group, description: group.label, items: pages.filter(page => page.group === group.id && !page.parent && canAccessPage(page.id, user as AuthUser, null)).map(page => ({ id: page.id, label: page.label })) })).filter(group => group.items.length);
}
export function navigationEntry(page: string) {
  const entry = pageById[page];
  const group = navigationGroups.find(item => item.id === (entry?.group ?? page));
  return { page: entry, group: group ? { id: group.id, label: group.label, description: group.label, items: [] as NavigationItem[] } : undefined };
}
export function resolveNavigationPage(page: string | null, user?: NavigationUser | null): string {
  const candidate = page ?? "overview";
  return !user || canAccessPage(candidate, user as AuthUser, null) ? resolvePage(candidate) : "overview";
}
export function pageFromSearch(search: string, user?: NavigationUser | null): string { return resolveNavigationPage(new URLSearchParams(search).get("page"), user); }
export function navigationUrl(href: string, page: string): string { const url = new URL(href, "https://local.invalid"); url.searchParams.set("page", page); return `${url.pathname}${url.search}${url.hash}`; }
