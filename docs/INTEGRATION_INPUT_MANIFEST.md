# 整合输入与来源指纹

## Git 来源身份

- 整合 worktree：`/workspace/plm-k3-reports-unified-20261024`，branch `feat/k3-reports-unified-20261024`，创建于报表候选 commit `40ee1b52489f0a628458627f1bad236fc11879a8`。
- API-only 源 commit：`bf06f37375a0c33e47060f22598050cbfe47a354`，其 parent 是 `7b0f2133353a5ddcf155cd0fbedddba70f7b322a`。
- `40ee1b5` 是 `7b0f213` 的后代；两个本地仓库中 `7b0f213` 的 commit/tree 完全相同，tree 为 `012624946e982ffa4a515339a198e30716a51044`。源 worktree 与 API-only worktree 的 `.git` common-dir 分别属于 `/workspace/fns-plm/.git` 和 `/workspace/personal-todo-project/.git`，但 `origin` 均为 `https://github.com/CenvyChan/fns-plm.git`。因此这是同一远端的独立本地仓库镜像，且由共同 commit/tree 证明有精确共享历史；不是仅路径不同。
- API patch 的两个目标文件在 `7b0f213` 与 `40ee1b5` 的 blob 完全相同；精确 patch 在临时 `40ee1b5` checkout 上 `git apply --check` 通过。整合时没有 cherry-pick，直接按共同 base 将 `7b0f213..bf06f373` 两文件 patch 应用至新 worktree。

## 40ee1b5 来源 worktree 的 8 条 dirty inputs

以下 SHA-256 是整合开始时来源 candidate dirty diff/文件的指纹。6 条 tracked 输入计算的是相对 `40ee1b5` 的二进制 diff；2 条 untracked 输入计算的是文件内容。

| Source path | 输入指纹 | 处置 |
|---|---|---|
| `client/src/OperationalReports.tsx` | `48c61671b69a375f8611e08f920019bb9e7374c37977eff2b1baff58cd70d7ac` | 保留并扩展：库存固定样本提示、fixture-only KPI/图表、采购/销售本地 demo UI。 |
| `client/tests/operational-reports.test.mjs` | `5fb86f5a3acc5efc7f08542fa1ba729d3fea063afec28afcd11f3831f5f88bc0` | 保留并扩展：字段、筛选、KPI/量纲与 UI contract tests。 |
| `server/src/integration-api.ts` | `ccba9cd1226c8b8310d7b856b88177648d068462a0e02f4ca30afe80707a6bf0` | 该 dirty diff 含较早库存 action 版本，明确不纳入；以精确 API-only commit patch 替换。 |
| `server/src/integrations/k3cloud.ts` | `783c1ad41f2854289fe0fc49628f65a10bb32ca02e04de8989e6feac0a7edd3b` | 该 dirty diff 含较早库存 action 版本，明确不纳入；以精确 API-only commit patch 替换。 |
| `server/src/operational-reports.ts` | `73b674641b1985546e1f5b800e38567d59cb1ab783fd91625363ab5f93dcd4d7` | 保留并扩展：不改原库存 fixture 边界，加入第二阶段 demo-only HTTP 路由。 |
| `server/tests/operational-reports-contract.test.mjs` | `77d0d2d916799d79a02b1a807c3df585eb1d451c582ca9f2f1c37dafcad08a92` | 保留并扩展相关契约检查。 |
| `docs/K3_REPORT_CANDIDATE_PREFLIGHT.md` | `785f621650c5aa94952c970c237e2bbe0e5971cdc20e984920f383a0efb816e1` | 复制后更新，补齐本轮范围、固定请求、fixture 与 live blockers。 |
| `server/tests/k3-inventory-actions-contract.test.mjs` | `79d2719c8685f3d496839a290ab677e2a881b5d3880bab49ae15cad4b0314a4a` | 旧候选测试不作为实现依据；目标路径改用 `bf06f373` commit 原始测试，目标文件 hash 与该 commit 相同。 |

这 8 条输入均已逐项登记；其中两个 dirty action 实现和其旧测试是经明确安全要求替换，而非遗漏或覆盖。来源 worktree 保持其原有 8 条 dirty 状态，整合工作只发生在本 worktree。

## 接线核对

`server/src/index.ts` 未修改：保留 `createOperationalReportsRouter()` 的 `/api` mount，也保留 `resolveWorkspaceSearch` import/use 两条接线。库存 action 的 route 位于 integration router；没有以 `ExecuteBillQuery` 伪装报表读取。本次不纳入 `/workspace/plm-api-only-release-helper` 的发布助手或备份工具改动。
