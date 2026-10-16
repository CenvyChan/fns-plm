# 第三方来源声明

本项目新增的日报对账领域结构借鉴并改编自 [CenvyChan/dailyReport](https://github.com/CenvyChan/dailyReport)（销售/采购日报模型、日报与金蝶库存发生明细的关联与部分金额分摊、三类对账观察、快照/更正约束）。为适用于当前 React/Express 项目，数据模型、路由、UI、持久化、权限和模拟数据均重新实现；未把 Django 项目作为运行依赖，也未移植或调用其外部服务代码。新增本地演示的订单和应收/应付摘要是独立扩展，来源仓库并无完整订单与往来账本模型。

来源仓库声明的版权方为 `Copyright (c) 2026 CenvyChan`，采用 MIT License。许可全文保留于 [`third_party/dailyReport/LICENSE`](third_party/dailyReport/LICENSE)。本项目对相关领域逻辑的改编标记为修改版本；真实 K3Cloud、邮件与钉钉均未在本轮连接或发送。
