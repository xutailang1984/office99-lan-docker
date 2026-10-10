# 办公室的99夜 · Docker 部署

这是与当前正式服务一致的 **v0.17.0 网页版部署包**，含完整游戏资源、服务文件、Windows/macOS 部署脚本和校验清单。部署电脑运行 Docker，玩家只需浏览器，无需安装 Docker、Godot 或 Blender。下载本仓库不会带走原服务器的账号或冒险数据；不同部署默认是独立的账号和存档。

本版包含八枪六钓具、个人成长与跨房携装、制作改造、探索破坏、差异化首领及办公室社交；新增房主离线接替与高风险机芯成长门槛。详见 [版本说明](RELEASE_NOTES.md)。Docker 提供网页、账号和确认存档，房主浏览器负责游戏模拟；中央服务仍须在线。

Windows Docker 正式服务已验证。本包面向 Intel/Apple 芯片 Mac 的 Docker 网页部署，但 **Mac 实机的页面、鼠标、声音、联机与存档仍须在目标机验证**。将仓库链接和 [AI_DEPLOY.md](AI_DEPLOY.md) 交给能够操作目标电脑的 AI 即可按步骤部署。

## 一次部署

先安装并启动 Docker（使用 Linux 容器及 Compose v2），安装 Node.js 20 或更新版本。首次构建需要联网下载基础镜像与依赖。下载完整仓库 ZIP 或 v0.17.0 Release 附件并解压，也可用 Git 克隆后检出 v0.17.0 标签；在仓库根目录运行：

Windows PowerShell：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
~~~

macOS / Linux 终端：

~~~sh
bash ./deploy.sh
~~~

脚本会校验发布包、构建并核对 Docker 镜像、启动服务，并等待健康接口返回相同版本。成功后在部署电脑打开 http://127.0.0.1:8080/；其他设备使用部署电脑的局域网 IP 和同一端口，网络与防火墙需允许该端口。部署后验证注册、建房、第二台电脑加入、保存退出和续玩。端口 8080 被占用时先核对已有服务，必要时指定别的端口：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Port 18080
~~~

~~~sh
bash ./deploy.sh --port 18080
~~~

## 账号和存档

**从公开旧版 v0.11.x 升级：** v0.12.0 起采用新的个人成长存档，当前版本使用 `data/platform-p1/`，需要重新注册并创建冒险。旧 `data/platform/` 保留作备份，不自动迁移或合并旧装备。先让玩家保存退出、停止旧服务、备份整个数据目录，确认接受此变化后再升级。不要删除旧数据来处理版本问题。v0.12.0 以后同代升级继续保留全部数据，不例行清空。

实际数据默认保存在仓库根目录的 data/，脚本不会清空或覆盖已有目录。release/docker-data/ 只是发布包校验所需的空目录，部署脚本会自动创建；请勿把真实存档放在那里。data/ 和本地 .env 均被 Git 忽略。

使用已有存档时，先确保旧服务已安全停止并完成备份，再指定原数据目录：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -DataDir 'D:\Office99Data'
~~~

~~~sh
bash ./deploy.sh --data-dir /path/to/Office99Data
~~~

不要让两个服务同时写同一份数据。升级时保留 data/，先备份，待房间清空再重新运行脚本。原发布包的详细部署和迁移说明见 [Docker 文档](release/docs/DOCKER-DEPLOYMENT.md)；本仓库脚本把数据放在 release/ 外，以便每次都能重新校验发布清单。

同一 Docker 引擎上的多份部署不能只靠改端口区分，Compose 项目名默认是 `office99`；让 AI 先核对现有容器。换电脑搬迁存档也需另行备份处理，浏览器本地检查点不会自动随网址转移。Docker 必须保持运行；容器自动恢复依赖引擎可用，不能把登录后启动等同于无人登录开机托管。

## 交给 AI 助理

把本仓库链接和 [AI 部署说明](AI_DEPLOY.md) 发给 AI 助理，并说明你用 Windows 还是 Mac。AI 助理可检查环境、运行对应脚本、验证页面和保存位置。首次安装 Docker 可能需要在电脑上完成系统授权。

网页版资源包内嵌了字体文件，字体的原样 OFL 许可证见 [third-party-licenses/OFL.txt](third-party-licenses/OFL.txt)。其他第三方资源声明见 [NOTICE](NOTICE.md)。项目整体授权尚未指定开源许可证。
