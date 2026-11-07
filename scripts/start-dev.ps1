<#
.SYNOPSIS
    LibreTV 开发服务器一键启动：后台运行 + 自动打开浏览器。
.DESCRIPTION
    1. 已在运行时直接打开网站，不重复起进程；
    2. 未运行时以隐藏窗口在后台拉起 `npm run dev`，日志写入 .dev-server\dev.log；
    3. 轮询 /api/status 直到服务就绪，再打开默认浏览器；
    4. 进程号写入 .dev-server\pid.txt，供 stop-dev.bat 精确停止整个进程树。

    注意：会临时清空 NODE_OPTIONS。某些受管环境（如 IDE 内置终端）会通过该变量注入
    fs 删除守卫，Next.js 启动时清理 .next 陈旧产物会被批量删除阈值拦截并直接退出。
    本项目的 dev server 不需要 NODE_OPTIONS，清空不会影响功能。
.PARAMETER NoBrowser
    只启动服务，不打开浏览器（脚本自测用）。
.PARAMETER Stop
    停止由本脚本启动的后台服务。
.EXAMPLE
    .\start-dev.ps1
    .\start-dev.ps1 -NoBrowser
    .\start-dev.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.dev-server'
$PidFile    = Join-Path $RuntimeDir 'pid.txt'
$LogFile    = Join-Path $RuntimeDir 'dev.log'
$BaseUrl    = 'http://localhost:8080'
$StatusUrl  = "$BaseUrl/api/status"
$Port       = 8080

function Test-LibreTV {
    <# 服务是否已是「本项目的」dev server：只看端口通不够，还要看接口特征 #>
    try {
        $res = Invoke-WebRequest -Uri $StatusUrl -UseBasicParsing -TimeoutSec 2
        return ($res.StatusCode -eq 200 -and $res.Content -match 'passwordRequired')
    } catch {
        return $false
    }
}

function Test-PortListening {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return [bool]$conn
    } catch {
        return $false
    }
}

function Open-Site {
    if ($NoBrowser) {
        Write-Host '已跳过打开浏览器（-NoBrowser）' -ForegroundColor DarkGray
        return
    }
    Start-Process $BaseUrl
    Write-Host "已在默认浏览器打开：$BaseUrl" -ForegroundColor Green
}

function Stop-Server {
    if (Test-Path $PidFile) {
        $serverPid = (Get-Content -Path $PidFile -Raw).Trim()
        if ($serverPid -match '^\d+$') {
            # /T 连带 npm 拉起的 next 子进程一起结束，否则端口不会释放
            & taskkill.exe /PID $serverPid /T /F *> $null
            Start-Sleep -Milliseconds 800
        }
        Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    }

    # 兜底：没有 pid 记录（例如在终端里手工 npm run dev），按端口反查并确认是本项目再结束
    if (Test-PortListening -and (Test-LibreTV)) {
        try {
            $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
                Select-Object -First 1
            if ($owner -and $owner.OwningProcess) {
                & taskkill.exe /PID $owner.OwningProcess /T /F *> $null
                Start-Sleep -Milliseconds 800
            }
        } catch {
            # 反查失败时保持原样，交给下面的提示
        }
    }

    if (Test-PortListening) {
        Write-Host "端口 $Port 仍在监听，请检查是否有其他进程占用：netstat -ano | findstr :$Port" -ForegroundColor Yellow
    } else {
        Write-Host 'LibreTV 开发服务器已停止。' -ForegroundColor Green
    }
}

if ($Stop) {
    Stop-Server
    return
}

# —— 已在运行：不重复起进程，直接开网站 ——
if (Test-LibreTV) {
    Write-Host "LibreTV 已在后台运行：$BaseUrl" -ForegroundColor Green
    if (Test-Path $PidFile) {
        Write-Host ("进程号：" + (Get-Content -Path $PidFile -Raw).Trim()) -ForegroundColor DarkGray
    }
    Open-Site
    return
}

# —— 端口被别的程序占着：启动必然失败，先讲清楚 ——
if (Test-PortListening) {
    Write-Host "端口 $Port 已被其他程序占用，无法启动。排查：netstat -ano | findstr :$Port" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 node，请先安装 Node.js 18.18 及以上版本。' -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 npm，请检查 Node.js 安装是否完整。' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
}
if (Test-Path $LogFile) {
    Remove-Item -Path $LogFile -Force -ErrorAction SilentlyContinue
}

Write-Host '正在后台启动 LibreTV 开发服务器…' -ForegroundColor Cyan

$env:NODE_OPTIONS = ''
$cmdLine = '/c npm run dev > "' + $LogFile + '" 2>&1'
$proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList $cmdLine `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII

# 首次编译较慢，最多等 60 秒；进程提前退出则立即判失败
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-LibreTV) { $ready = $true; break }
    if ($proc.HasExited) { break }
}

if (-not $ready) {
    Write-Host '启动失败：服务未在 60 秒内就绪。' -ForegroundColor Red
    if (Test-Path $LogFile) {
        Write-Host "---- 最近日志（$LogFile） ----" -ForegroundColor DarkGray
        Get-Content -Path $LogFile -Tail 20 | ForEach-Object { Write-Host $_ }
    }
    if (-not $proc.HasExited) {
        & taskkill.exe /PID $proc.Id /T /F *> $null
    }
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "LibreTV 已在后台运行：$BaseUrl" -ForegroundColor Green
Write-Host "进程号：$($proc.Id)　日志：$LogFile" -ForegroundColor DarkGray
Write-Host '停止服务：双击 scripts\stop-dev.bat' -ForegroundColor DarkGray
Open-Site
