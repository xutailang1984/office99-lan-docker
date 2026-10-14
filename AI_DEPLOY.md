# 给 AI 助理的部署任务 · v0.18.0

请把这个仓库的链接交给 AI 助理，并复制下面这段要求：

> 请在我的 Windows 或 Mac 电脑部署这个仓库中的《办公室的99夜》v0.18.0 Docker 网页版。先确认 Docker Desktop 已启动且使用 Linux 容器，并确认 Node.js 版本至少为 20；缺少时协助安装，需要系统授权时说明原因。下载完整仓库后，Windows 运行根目录 deploy.ps1，Mac 运行 deploy.sh。部署完成后检查版本、页面、局域网联机和保存续玩，并告诉我局域网访问地址、存档目录和未验证项。不要上传账号或存档，不要删除已有数据。若发现本机已有旧服务或现有数据目录，先核对并备份，避免两套服务同时写同一份数据。

执行要点：

1. 下载完整仓库或 v0.18.0 Release 附件，保留 release/、根目录脚本与许可证。使用 Git 可克隆后检出 v0.18.0 标签。确认 release/release-manifest.json 的 version 为 0.18.0。不要只下载脚本或零散源码，也不需要重新导出 Godot 游戏。
2. 确认 Docker 引擎、Compose v2 和 Node.js 20+ 可用。Windows Docker Desktop 要使用 Linux 容器；Mac 的 Intel 和 Apple 芯片均构建对应架构的 Linux 镜像。
3. 进入仓库根目录，Windows 执行以下命令；如需改端口，追加 -Port 端口号：

   ~~~powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
   ~~~

   Mac 执行以下命令；如需改端口，追加 --port 端口号：

   ~~~sh
   bash ./deploy.sh
   ~~~

4. 执行前核对现有容器、8080端口、数据目录和在线房间，升级时等待保存退出并备份。Compose 项目名默认 office99，同一引擎上的多份部署不能只靠改端口区分；不要覆盖或停止不相关服务。Windows 用 -DataDir 指定数据，Mac 用 --data-dir；默认根部 data/。路径有空格须正确引用。真实数据不能放进 release/ 或 GitHub。
5. 检查脚本成功输出，并确认 /health 的 ready 为 true、build 为 0.18.0。打开 http://127.0.0.1:8080/ 或指定端口，使用合成测试账号验证注册/登录、入职或自由试用、建房、键鼠和声音、保存退出及恢复。跨设备时查询本机局域网IP，核对网络与防火墙，验证第二台设备加入、移动、射击与聊天。直连失败时检查同站中转；只做本机验证时明确标注跨设备未测。
6. 如果检查失败，保留数据和日志，报告失败步骤；不要改用空存档目录掩盖问题，也不要启动第二套服务抢占原端口。

脚本会在构建前校验 release/release-manifest.json 中每个文件的大小与 SHA-256，构建后再次核对镜像内文件。首次镜像构建需要联网获取官方 Node 基础镜像与服务器依赖。release/docker-data/ 是必须保持为空的校验目录，实际数据位于仓库根部 data/ 或显式指定的目录。

**旧版升级：v0.11.x → v0.18.0 采用新的 platform-p1 存档，需要重新注册并创建冒险，旧 platform 只保留备份、不自动合并。** 使用旧数据时向用户说明并确认升级意图。v0.12.0 之后同代升级保留完整数据目录，不主动清空。新电脑默认独立账号与存档，不自动同步原 Windows 服务；原数据搬迁需另行安排备份迁移。

这份发布包版本为 v0.18.0。Mac 需在目标机完成实际页面、联机、声音、鼠标和存档验证；Windows 结果不能代替 Mac 实机结果。首次安装 Docker 可能需要用户授权。交付时说明实际版本、地址、数据位置及未验证项；登录后启动 Docker 不代表无人登录开机一定恢复。玩家无需安装 Docker、Godot 或 Blender。
