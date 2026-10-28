# 第三方来源声明

本项目新增的日报对账领域结构借鉴并改编自 [CenvyChan/dailyReport](https://github.com/CenvyChan/dailyReport)（销售/采购日报模型、日报与金蝶库存发生明细的关联与部分金额分摊、三类对账观察、快照/更正约束）。为适用于当前 React/Express 项目，数据模型、路由、UI、持久化、权限和模拟数据均重新实现；未把 Django 项目作为运行依赖，也未移植或调用其外部服务代码。新增本地演示的订单和应收/应付摘要是独立扩展，来源仓库并无完整订单与往来账本模型。

来源仓库声明的版权方为 `Copyright (c) 2026 CenvyChan`，采用 MIT License。许可全文保留于 [`third_party/dailyReport/LICENSE`](third_party/dailyReport/LICENSE)。本项目对相关领域逻辑的改编标记为修改版本；真实 K3Cloud、邮件与钉钉均未在本轮连接或发送。
## 隔离 BPMN 模型设计器

- [bpmn-js 18.31.0](https://github.com/bpmn-io/bpmn-js) 使用 bpmn.io License，许可证见 `third_party/bpmn-js/LICENSE`。保留库原生 bpmn.io 可见回链水印，不以自制文字替代、不隐藏或覆盖。
- [bpmn-moddle 10.3.1](https://github.com/bpmn-io/bpmn-moddle) 使用 MIT License，见 `third_party/bpmn-moddle/LICENSE`。
- [saxes 6.0.0](https://github.com/lddubeau/saxes) 使用 ISC License，见 `third_party/saxes/LICENSE`。仅用于无外部资源加载的 XML 语法检查；声明/DTD/实体在进入解析器前已被拒绝。

`client/src/flowable-minimal-moddle.json` 是本项目自有最小扩展描述符，不是官方 Flowable moddle 包，不包含商业或云设计器代码；仅声明用户任务 assignee/candidateUsers/candidateGroups 属性，PLM 角色由服务端展开为 scoped candidateUsers。未引入 bpmn-js-properties-panel，属性面板由现有 React/TypeScript 实现。
