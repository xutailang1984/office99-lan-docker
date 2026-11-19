# 在 Mac 部署与继续开发

本仓库包含可运行的网页版和可编辑的开发源码。启动后，登录页应同时显示 **PVE 0.18.0** 和 **MOBA 0.5.0**。请用桌面浏览器与键鼠进行游戏验收。

## 获取项目

使用 Mac 终端。在希望存放源码的目录中执行：

```sh
git clone https://github.com/xutailang1984/office99-lan-docker.git
cd office99-lan-docker
git rev-parse HEAD
uname -m
node -v
```

Node.js 使用 22 系列。`arm64` 表示 Apple 芯片，`x86_64` 表示 Intel 芯片。若 Mac 已有这份仓库或正在运行旧版，请保留未提交的源码改动，先记录服务、数据目录和在线房间，再决定是否升级。可用 `lsof -nP -iTCP:8080 -sTCP:LISTEN` 检查端口。

## 启动服务

两种方式选一种。默认存档目录是仓库根部的 `data/`，新 Mac 从空目录启动时需要创建本地账号。保留该目录即可续玩。

**Docker** 适合固定的局域网服务。打开 Docker Desktop 并确认 `docker info` 和 `docker compose version` 可用，然后在仓库根目录运行：

```sh
bash ./deploy.sh
```

端口占用时可用 `--port 18080`，需要把保存目录放在别处时可用 `--data-dir "/实际的存档目录"`。脚本会先校验发布文件，再启动和检查服务。用同一套配置重启服务可以继续读取原存档。已有服务时先确认项目名和数据归属，避免两套进程同时写入同一目录。

**直接用 Node.js** 适合本机体验和后续开发。在终端运行：

```sh
npm --prefix server ci --omit=optional
node tools/run-local.mjs
```

默认只从本机访问 [游戏入口](http://127.0.0.1:8080/)。想邀请同一局域网的同事时，以 `--lan` 启动，然后把 `http://<Mac 的局域网 IP>:8080/` 发给对方。可以在 macOS 的网络设置中找到 IP。在游戏中保存并退出后，可回到启动终端用 `Ctrl+C` 停止服务。

## 验证部署

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/health
curl --fail --silent --show-error http://127.0.0.1:8080/moba/status
```

如果换了端口，两条命令和浏览器地址都用实际端口。检查健康接口 `ready: true`、`build: "0.18.0"`，MOBA 状态接口 `enabled: true`、`version: "moba-0.5.0"`。接着在游戏入口实测：

1. 登录前可看到两个版本。新建临时账号，刷新后可以重新登录。
2. 进入 PVE，验证键鼠与声音，保存退出并重新进入同一冒险。
3. 进入 MOBA，创建带机器人的房间，选角色、开局，测试镜头靠边平移、右键移动及施法。对局流程见 [MOBA 验收清单](ACCEPTANCE-MOBA-0.5.0.md)。
4. 要验收局域网时，用第二台实际设备登录、加入房间并确认操作同步。在 Mac 本机完成的测试可记录为本机通过。

记录 Mac 的系统版本、芯片、Git 提交、运行方式、浏览器、双版本、数据目录和上述步骤的结果。后续换机器时先备份存档，安排单独的搬迁核对。禁止把真实存档或配置提交到仓库。

### 已验证的范围

2026-11-19 对照正在部署的 PVE 0.18.0 和 MOBA 0.5.0。GitHub 发布包校验通过，共 250 个文件。

| 验证环境 | 实际结果 |
| --- | --- |
| GitHub 托管 macOS Apple 芯片和 Intel | 双模式启动、注册、建房、重启后账号与冒险恢复通过。每种架构的 1,430 项规则测试均通过。 |
| GitHub 托管 macOS Apple 芯片 | 利用官方 Godot 4.7.2 和 Web 模板从源码导出成功。 |
| GitHub 托管 Linux ARM64 和 AMD64 | 通过部署脚本建镜像并启动，双模式房间流程通过。 |
| macOS 托管无窗口 Chromium | MOBA 进场、锁定镜头、右键移动、退回大厅通过。PVE 房间已运行，进入画面的自动检查超时。 |
| Windows Chromium | 冻结包与源码重导出包均通过双模式画面与键鼠检查。 |

自动化结果见 [GitHub Actions](https://github.com/xutailang1984/office99-lan-docker/actions/runs/44533240979)。Mac 图形检查的超时见 [Intel 记录](https://github.com/xutailang1984/office99-lan-docker/actions/runs/44532338156/job/135588643136) 和 [Apple 芯片记录](https://github.com/xutailang1984/office99-lan-docker/actions/runs/44532131207/job/135587911561)。接手助理应在目标 Mac 的桌面 Chrome 或 Edge 优先实际进入 PVE，确认画面、鼠标和声音。还需要第二台设备验证该 Mac 所在局域网的连接。若选择 Docker Desktop，也在目标机运行一次部署脚本。

## 继续开发

从仓库根目录安装依赖并运行规则测试：

```sh
npm --prefix server ci --omit=optional
npm --prefix server test
```

使用 Godot 编辑 `client/project.godot`。重新导出时安装官方 Godot **4.7.2** 和同版本的 Web 导出模板。在 Godot 编辑器的导出模板管理器中安装模板。若 Godot 的应用在自定义位置，可以设置 `GODOT_EXE` 指向其内部可执行文件，例如 `/Applications/Godot.app/Contents/MacOS/Godot`。

```sh
node tools/build-candidate.mjs .runtime/dev-web
node tools/run-local.mjs --port 18080 --web-root .runtime/dev-web --data-dir .runtime/dev-data
```

候选入口为 [本机开发版](http://127.0.0.1:18080/)，和首次部署使用不同的端口与数据目录。编辑后用相同的构建命令更新候选输出，再回归试玩受影响模式。玩法逻辑要点：`server/survival/` 和 `server/moba/` 保存共享规则，`client/survival/` 和 `client/moba/` 渲染游戏，`client/platform/` 和 `client/moba-web/` 负责浏览器大厅、输入桥接和联机。

交接时留下当前提交、构建和测试命令、实际跑过的验收步骤，以及仍需在目标 Mac 或局域网验证的项目。素材来源和许可证见 [版权与第三方资源](../NOTICE.md)。
