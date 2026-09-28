[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,
    [string]$DataDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $repoRoot 'release'
$releaseData = Join-Path $releaseRoot 'docker-data'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 20 或更新版本。' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '请先安装并启动 Docker Desktop。' }

$nodeMajorText = & node -p "process.versions.node.split('.')[0]"
$nodeMajor = 0
if ($LASTEXITCODE -ne 0 -or -not [int]::TryParse($nodeMajorText, [ref]$nodeMajor)) {
    throw '无法读取 Node.js 版本。'
}
if ($nodeMajor -lt 20) { throw 'Node.js 版本低于 20，请先升级。' }

$dockerOs = & docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop 尚未运行。' }
if ($dockerOs.Trim() -ne 'linux') { throw '请把 Docker Desktop 切换到 Linux 容器。' }
& docker compose version --short | Out-Null
if ($LASTEXITCODE -ne 0) { throw '需要 Docker Compose v2。' }

if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) { throw '缺少 release 发布目录。' }
if (Test-Path -LiteralPath $releaseData) {
    if (-not (Test-Path -LiteralPath $releaseData -PathType Container)) { throw 'release/docker-data 不是目录。' }
} else {
    New-Item -ItemType Directory -Path $releaseData | Out-Null
}
if (@(Get-ChildItem -LiteralPath $releaseData -Force).Count -ne 0) {
    throw 'release/docker-data 必须保持空目录。发现原有文件时请先让 AI 助理协助迁移，不会自动移动或删除。'
}

& node (Join-Path $releaseRoot 'tools/verify-docker-release.mjs') $releaseRoot
if ($LASTEXITCODE -ne 0) { throw '发布包校验失败，停止部署。' }

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $dataPath = Join-Path $repoRoot 'data'
} elseif ([IO.Path]::IsPathRooted($DataDir)) {
    $dataPath = $DataDir
} else {
    $dataPath = Join-Path $repoRoot $DataDir
}
$dataPath = [IO.Path]::GetFullPath($dataPath)
$releasePrefix = $releaseRoot.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
if ($dataPath.Equals($releaseRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $dataPath.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw '存档目录不能放在 release 里面。'
}
if (Test-Path -LiteralPath $dataPath) {
    if (-not (Test-Path -LiteralPath $dataPath -PathType Container)) { throw '存档路径不是目录。' }
} else {
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
}

$oldPort = [Environment]::GetEnvironmentVariable('OFFICE99_PORT', 'Process')
$oldDataDir = [Environment]::GetEnvironmentVariable('OFFICE99_DATA_DIR', 'Process')
$pushed = $false
try {
    $env:OFFICE99_PORT = [string]$Port
    $env:OFFICE99_DATA_DIR = $dataPath
    Push-Location -LiteralPath $releaseRoot
    $pushed = $true

    & docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 配置无效。' }
    & node tools/build-docker-release.mjs . --tag office99-lan:local
    if ($LASTEXITCODE -ne 0) { throw 'Docker 镜像构建或校验失败。' }
    & docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw 'Docker 服务启动失败。' }

    $url = 'http://127.0.0.1:' + $Port + '/'
    $healthy = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        try {
            $result = Invoke-RestMethod -Uri ($url + 'health') -TimeoutSec 3
            if ($result.ready -eq $true) { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw '服务在 90 秒内未通过健康检查，请查看 docker compose ps 和 logs。' }

    Write-Host ('部署完成：' + $url) -ForegroundColor Green
    Write-Host ('存档目录：' + $dataPath)
    Write-Host '其他电脑使用部署机的局域网 IP 和相同端口访问。'
} finally {
    if ($pushed) { Pop-Location }
    [Environment]::SetEnvironmentVariable('OFFICE99_PORT', $oldPort, 'Process')
    [Environment]::SetEnvironmentVariable('OFFICE99_DATA_DIR', $oldDataDir, 'Process')
}
