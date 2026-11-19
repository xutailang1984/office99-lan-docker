# Office99 开发交接

- 先读 [Mac 部署与开发指南](docs/MAC-HANDOFF.md) 和 [测试与验收流程](docs/TESTING-AND-ACCEPTANCE.md)。
- `client/`、`server/` 和 `art/office-models/` 是开发输入，`release/` 是供部署的冻结包。开发时运行独立候选并使用独立数据目录。
- 发布包须保持 PVE 与 MOBA 一起可用。共享世界规则从 `server/` 同步到浏览器，编辑后通过构建工具重新导出。
- 账号、存档、秘密、本机配置和运行缓存留在本地。已有服务先核对端口和数据归属。公开分支、发布及正式服务变更按用户授权执行。
- 基础回归用 `npm --prefix server test` 和 `node tools/test-local-deploy.mjs`。改到实际交互时再跑浏览器验证，记录系统、架构与覆盖范围。
