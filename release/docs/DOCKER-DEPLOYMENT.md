# 《办公室的99夜》跨系统网页部署

这套 Docker 部署运行账号、大厅、网页资源、信令和备份。创建房间的玩家仍在自己的浏览器里运行游戏世界；房主和队友不需要安装 Docker。**同一时间只运行一个服务实例**，不要让 Windows 旧服务与容器同时写同一份存档。

## 获取可部署的文件

推荐从已经验收的游戏发布目录制作发布包，例如 `node tools/package-docker-release.mjs --release-root <已验证的发布目录>`。脚本核对原发布清单中每个文件的 SHA-256，包含完整 `web/`、Node 服务、Docker 配置、构建/校验工具和新清单，**不包含真实账号、存档或 GM 配置**。可把 `.runtime/docker-distributions/*.tar.gz` 作为日后的 GitHub Release 资产；从 Windows、Mac 或 Linux 下载并解压同一发布包即可部署。解压后先运行 `node tools/verify-docker-release.mjs .`，验证文件数量、大小和哈希。

单纯复制源码目录还不够：`web/` 是本地导出产物，当前不纳入源码仓库。开发机也可先用 Godot 4.7.2 导出 Web，并运行 `node tools/finalize_web.mjs web`，再运行不带参数的打包命令；该路径记为尚未经过正式发布清单核对的工作区导出。Docker 构建会检查关键 PCK、WASM、页面和房主 Worker 是否齐全，缺失时拒绝生成镜像。

## 首次启动

在解压后的发布包目录中，先确认 Docker 使用 Linux 容器，并安装 Node.js 20 或以上版本供构建工具使用。执行：

```sh
node tools/verify-docker-release.mjs .
node tools/build-docker-release.mjs . --tag office99-lan:local
docker compose up -d --no-build
docker compose ps
```

构建工具会逐一核对发布包和生成镜像中的服务器、网页文件，成功后才赋予镜像标签。本机有文件加密软件：直接执行 `docker build .` 或 `docker compose build` 可能把加密后的网页字节放入镜像，造成首页乱码，所以部署统一使用上面的构建工具。Linux/Mac 也使用同一流程。若希望指定 CPU 架构，可为构建工具加 `--platform linux/amd64` 或 `--platform linux/arm64`。

默认访问 `http://<部署电脑的局域网地址>:8080/`。`docker-data/` 是账号和冒险存档目录；发布包预建空目录，后续升级时保留，切勿放进镜像或覆盖。Docker Desktop 在 Windows/Mac 上运行 Linux 容器，Linux 主机可使用 Docker Engine。要改变端口或存档目录，可在本机创建不上传的 `.env`：

```text
OFFICE99_PORT=18080
OFFICE99_DATA_DIR=./docker-data
```

其他电脑能否打开仍取决于部署电脑的局域网路由和防火墙。WebRTC 由玩家浏览器直连，失败时使用同站 WebSocket 中转；不需要为每个房间开放新端口。只开放所选网页端口即可。

## 从旧 Windows 服务迁移

先在**另一个端口与空的测试数据目录**验证容器，确认注册、建房、双浏览器联机、保存、停机、重新启动及续玩。正式迁移时，等待房间清空，正常停止旧服务，备份并校验整个原数据目录；同时停用旧服务的自动启动入口，防止它抢占 8080 或与容器双写。然后把原数据目录作为容器的 `OFFICE99_DATA_DIR`，在原网址/端口启动容器。若需回退，先正常停止容器，再只启动旧服务。不得让两套服务并行访问原数据目录。

迁移时尽量保持原 IP、端口和网址。房主浏览器的最新本地检查点按网址隔离；换地址后，只能从已送达中央服务的备份恢复。迁移时必须核对原账号、冒险数量、存档文件指纹和一次真实保存续玩。Docker `restart: unless-stopped` 只在 Docker 引擎运行时生效；在 Windows 上正式替代开机托管前，需实测无人登录后的冷启动与局域网访问。

## 更新与跨系统验证

新版本重新制作发布包，保留原 `docker-data/`，空房时使用构建工具生成新镜像，再运行 `docker compose up -d --no-build`。容器通过 SIGTERM 安全停机，Compose 最多等待 60 秒；若保存失败，应保留原数据、停止切换并排查，不要用空目录重新开服。运行 `docker compose ps` 查看健康状态，再检查 `/health`、大厅、`play.html`、PCK/WASM、加入房间和保存恢复。

镜像基于官方多架构 Node Linux 基础镜像，可分别构建 `linux/amd64` 与 `linux/arm64`，供普通 PC 和 Apple 芯片 Mac 的 Docker 使用。一个系统上构建成功不能代替另一系统的实机验收；首次换主机时要在目标电脑完成页面、联机、声音、鼠标与存档测试。[Docker 多平台构建说明](https://docs.docker.com/build/building/multi-platform/)。
