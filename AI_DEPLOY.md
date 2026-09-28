# 给 AI 助理的部署任务

请把这个仓库的链接交给 AI 助理，并复制下面这段要求：

> 请在我的 Windows 或 Mac 电脑部署这个仓库中的《办公室的99夜》Docker 网页版。先确认 Docker Desktop 已启动且使用 Linux 容器，并确认 Node.js 版本至少为 20；缺少时引导我安装。下载完整仓库后，Windows 运行根目录 deploy.ps1，Mac 运行 deploy.sh。部署完成后检查健康接口、首页和实际访问端口，并告诉我局域网访问地址与存档目录。不要上传账号或存档，不要删除已有数据。若发现本机已有旧服务或现有数据目录，先核对并备份，避免两套服务同时写同一份数据。

执行要点：

1. 下载仓库 ZIP 或克隆仓库，保留 release/ 全部文件。不要只下载脚本或 GitHub 自动生成的不含 release/ 的旧源码包。
2. 确认 Docker 引擎、Compose v2 和 Node.js 20+ 可用。Windows Docker Desktop 要使用 Linux 容器；Mac 的 Intel 和 Apple 芯片均构建对应架构的 Linux 镜像。
3. 进入仓库根目录，Windows 执行以下命令；如需改端口，追加 -Port 端口号：

   ~~~powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
   ~~~

   Mac 执行以下命令；如需改端口，追加 --port 端口号：

   ~~~sh
   bash ./deploy.sh
   ~~~

4. 如需使用已有数据，先核对该目录属于这套游戏并制作备份。Windows 用 -DataDir 指定路径，Mac 用 --data-dir；脚本默认使用仓库根部 data/。不要把真实数据放进 release/，也不要把数据提交到 GitHub。
5. 检查脚本的成功输出，再打开 http://127.0.0.1:8080/ 或指定端口。跨设备访问时查询部署电脑的局域网地址，确认网络和防火墙允许该端口。核对首页、创建/登录、建房、保存、重新启动后的继续冒险。
6. 如果检查失败，保留数据和日志，报告失败步骤；不要改用空存档目录掩盖问题，也不要启动第二套服务抢占原端口。

脚本会在构建前校验 release/release-manifest.json 中每个文件的大小与 SHA-256，构建后再次核对镜像内文件。首次镜像构建需要联网获取官方 Node 基础镜像与服务器依赖。release/docker-data/ 是必须保持为空的校验目录，实际数据位于仓库根部 data/ 或显式指定的目录。

这份发布包版本为 v0.11.8。Mac 部署需要在目标 Mac 上完成实际页面、联机、声音、鼠标和存档验证；Windows 的验证结果不能代替 Mac 实机结果。
