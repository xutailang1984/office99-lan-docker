# 办公室的99夜

网页版包含 **PVE 0.18.0** 和 **MOBA 0.5.0**。这个仓库同时提供可直接运行的发布文件和可编辑的开发源码。玩家通过浏览器加入。

## 在 Mac 打开游戏

安装 Node.js 22，在[下载仓库](https://github.com/xutailang1984/office99-lan-docker)或克隆后，从仓库根目录运行：

```sh
npm --prefix server ci --omit=optional
node tools/run-local.mjs
```

打开 [本机游戏](http://127.0.0.1:8080/)。让同一局域网的同事加入时，用 `node tools/run-local.mjs --lan` 启动，其他人访问这台电脑的局域网 IP 和端口。

长期运行也可使用 Docker。启动 Docker 后，在 Mac/Linux 运行 `bash ./deploy.sh`，在 Windows PowerShell 运行 `.\deploy.ps1`。若 8080 已用于其他服务，可给 Docker 脚本指定 `--port 18080` 或 `-Port 18080`。两个脚本都会校验发布文件并确认两个游戏版本都已就绪。

每台新部署拥有自己的账号和存档，默认写入仓库根目录的 `data/`。升级前先让玩家退出并备份整个目录；如果已有游戏服务，切换前须确认项目名、端口和目录归属。同一份数据只能由一套服务写入。

## 交给智能助理继续开发

把仓库链接和 [AI_DEPLOY.md](AI_DEPLOY.md) 交给能操作目标 Mac 的智能助理。它可按 [Mac 部署与开发指南](docs/MAC-HANDOFF.md) 验证运行、打开 Godot 工程和重新导出候选包。

游戏源码在 `client/` 与 `server/`，发布版的网页和服务文件在 `release/`。更新源码后，先在独立端口验证新导出。交验按 [测试与验收流程](docs/TESTING-AND-ACCEPTANCE.md) 与 [MOBA 验收清单](docs/ACCEPTANCE-MOBA-0.5.0.md) 进行。

第三方资源和授权范围见 [NOTICE](NOTICE.md)。
