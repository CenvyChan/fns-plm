# Flowable staging 验证说明

仓库历史中曾记录一个隔离 staging 环境的部署与任务流程验证。其主机地址、账户范围和环境识别信息已从公共文件中移除；本说明不证明当前服务仍可用，也不授权对任何引擎执行操作。

当前代码要求 staging 地址由部署环境显式配置并精确加入 `FLOWABLE_HTTP_ALLOWLIST`，发布环境还需单独配置 `FLOWABLE_VERIFIED_STAGING_URL` 和验证开关。代码库本身不包含内部主机值。生产环境未在本轮访问或修改。
