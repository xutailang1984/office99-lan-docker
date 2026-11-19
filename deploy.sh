#!/usr/bin/env bash
set -Eeuo pipefail

port=8080
data_arg=''
while (($#)); do
  case "$1" in
    --port)
      (($# >= 2)) || { echo '缺少 --port 的值。' >&2; exit 1; }
      port=$2
      shift 2
      ;;
    --data-dir)
      (($# >= 2)) || { echo '缺少 --data-dir 的值。' >&2; exit 1; }
      data_arg=$2
      shift 2
      ;;
    -h|--help)
      echo '用法：bash deploy.sh [--port 8080] [--data-dir 存档目录]'
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 1
      ;;
  esac
done
[[ "$port" =~ ^[0-9]+$ ]] || { echo '端口必须是 1 到 65535。' >&2; exit 1; }
port=$((10#$port))
((port >= 1 && port <= 65535)) ||
  { echo '端口必须是 1 到 65535。' >&2; exit 1; }

repo_root=$(cd -- "$(dirname -- "$0")" && pwd -P)
release_root="$repo_root/release"
release_data="$release_root/docker-data"

command -v node >/dev/null 2>&1 || { echo '请先安装 Node.js 20 或更新版本。' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo '请先安装并启动 Docker。' >&2; exit 1; }
node_major=$(node -p "process.versions.node.split('.')[0]")
((node_major >= 20)) || { echo 'Node.js 版本低于 20，请先升级。' >&2; exit 1; }
docker_os=$(docker info --format '{{.OSType}}') || { echo 'Docker 尚未运行。' >&2; exit 1; }
[[ "$docker_os" == linux ]] || { echo '请使用 Docker 的 Linux 容器。' >&2; exit 1; }
docker compose version --short >/dev/null || { echo '需要 Docker Compose v2。' >&2; exit 1; }
host_uid=$(id -u)
host_gid=$(id -g)
[[ "$host_uid" != 0 ]] || { echo '请用平时登录电脑的用户运行部署脚本。' >&2; exit 1; }

[[ -d "$release_root" ]] || { echo '缺少 release 发布目录。' >&2; exit 1; }
mkdir -p -- "$release_data"
[[ -d "$release_data" ]] || { echo 'release/docker-data 不是目录。' >&2; exit 1; }
if [[ -n $(ls -A "$release_data") ]]; then
  echo 'release/docker-data 必须保持空目录。发现原有文件时请先让 AI 助理协助迁移，不会自动移动或删除。' >&2
  exit 1
fi
node "$release_root/tools/verify-docker-release.mjs" "$release_root"
expected_version=$(node -p 'require(process.argv[1]).version' "$release_root/release-manifest.json")
expected_moba=$(node -p 'require(process.argv[1]).mobaVersion' "$release_root/release-manifest.json")

if [[ -z "$data_arg" ]]; then
  data_path="$repo_root/data"
else
  data_path=$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1],process.argv[2]))' "$repo_root" "$data_arg")
fi
case "$data_path/" in
  "$release_root/"*) echo '存档目录不能放在 release 里面。' >&2; exit 1 ;;
esac
mkdir -p -- "$data_path"
data_path=$(cd -- "$data_path" && pwd -P)
case "$data_path/" in
  "$release_root/"*) echo '存档目录不能放在 release 里面。' >&2; exit 1 ;;
esac

export OFFICE99_PORT="$port"
export OFFICE99_DATA_DIR="$data_path"
export OFFICE99_DOCKER_USER="$host_uid:$host_gid"
cd -- "$release_root"
docker compose config --quiet
node tools/build-docker-release.mjs . --tag office99-lan:moba-050
if ! docker compose run --rm --no-deps --entrypoint node game -e '
  const {writeFileSync,unlinkSync}=require("node:fs");
  const filename="/data/.office99-"+require("node:crypto").randomUUID();
  writeFileSync(filename,"", {flag:"wx",mode:0o600});
  unlinkSync(filename);
'; then
  echo '容器无法写入所选存档目录。请检查目录归属与 Docker 文件共享设置。' >&2
  exit 1
fi
docker compose up -d --no-build

healthy=0
for ((attempt=0; attempt<45; attempt++)); do
  if node -e '
    const [port,pve,moba]=process.argv.slice(1), origin="http://127.0.0.1:"+port;
    async function read(route) {
      const response=await fetch(origin+route,{signal:AbortSignal.timeout(3000)});
      if(!response.ok) throw Error(route);
      return response.json();
    }
    Promise.all([read("/health"),read("/moba/status")]).then(([h,m])=>{
      process.exit(h.ready&&h.build===pve&&m.enabled&&m.version===moba?0:1);
    }).catch(()=>process.exit(1));
  ' "$port" "$expected_version" "$expected_moba" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
((healthy == 1)) || { echo '服务未通过就绪及版本检查，请查看端口、docker compose ps 和 logs。' >&2; exit 1; }

echo "部署完成：http://127.0.0.1:$port/"
echo "存档目录：$data_path"
echo '其他电脑使用部署机的局域网 IP 和相同端口访问。'
