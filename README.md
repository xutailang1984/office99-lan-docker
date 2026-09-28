# 办公室的99夜 · Docker 部署

这是已校验的 v0.11.8 网页版部署包，可在 Windows 和 macOS 的 Docker Desktop、以及 Linux Docker Engine 上运行。玩家只需用浏览器访问部署电脑的地址。下载本仓库不会带走原服务器的账号或冒险数据。

本版加入可打黄灯弱点、连动补给桶的报废复印机；目标信息移到右侧，开镜时仍可看清准星。旧冒险当天保留原场景，次日再出现新设备，已有存档不必重开。

## 一次部署

先安装并启动 Docker（使用 Linux 容器），安装 Node.js 20 或更新版本。下载本仓库的 ZIP 并完整解压，或用 Git 克隆；在仓库根目录运行：

Windows PowerShell：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
~~~

macOS / Linux 终端：

~~~sh
bash ./deploy.sh
~~~

脚本会校验发布包、构建 Docker 镜像、启动服务，并等待健康检查通过。成功后在部署电脑打开 http://127.0.0.1:8080/；其他设备使用部署电脑的局域网 IP 和同一端口。端口 8080 被占用时可以指定别的端口：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Port 18080
~~~

~~~sh
bash ./deploy.sh --port 18080
~~~

## 账号和存档

实际数据默认保存在仓库根目录的 data/，脚本不会清空或覆盖已有目录。release/docker-data/ 只是发布包校验所需的空目录，部署脚本会自动创建；请勿把真实存档放在那里。data/ 和本地 .env 均被 Git 忽略。

使用已有存档时，先确保旧服务已安全停止并完成备份，再指定原数据目录：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -DataDir 'D:\Office99Data'
~~~

~~~sh
bash ./deploy.sh --data-dir /path/to/Office99Data
~~~

不要让两个服务同时写同一份数据。升级时保留 data/，先备份，待房间清空再重新运行脚本。原发布包的详细部署和迁移说明见 [Docker 文档](release/docs/DOCKER-DEPLOYMENT.md)；本仓库脚本把数据放在 release/ 外，以便每次都能重新校验发布清单。

## 交给 AI 助理

把本仓库链接和 [AI 部署说明](AI_DEPLOY.md) 发给 AI 助理，并说明你用 Windows 还是 Mac。AI 助理可检查环境、运行对应脚本、验证页面和保存位置。首次安装 Docker 可能需要在电脑上完成系统授权。

网页版资源包内嵌了字体文件，字体的原样 OFL 许可证见 [third-party-licenses/OFL.txt](third-party-licenses/OFL.txt)。其他第三方资源声明见 [NOTICE](NOTICE.md)。项目整体授权尚未指定开源许可证。
