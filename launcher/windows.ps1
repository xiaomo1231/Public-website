#Requires -Version 5.1
<#
  AI 学习平台 — Windows 启动器

  职责（仅系统环境管理）：
    1. 检测 Node.js 是否存在、版本是否满足 package.json 的 engines 要求
    2. 检测 npm 是否可用
    3. 缺少或版本过低时，先询问用户，得到确认后才尝试安装（winget）
    4. 安装后重新检测，不假设成功
    5. 检查依赖是否完整，必要时安装
    6. 启动开发服务器

  隐私：只检测 Node.js / npm / 操作系统版本。
        不收集用户名、硬件、网络或文件信息，无遥测，无上报。
  安全：不静默安装；不提权；不下载第三方安装包；日志不含任何密钥。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$LogPath = Join-Path $PSScriptRoot 'launcher.log'
$DevUrl = 'http://localhost:5173'
$NodeDownloadUrl = 'https://nodejs.org/zh-cn/download'
$WingetNodeId = 'OpenJS.NodeJS.LTS'

# --------------------------------------------------------------------------
# 输出辅助
# --------------------------------------------------------------------------
function Write-Banner {
  Write-Host ''
  Write-Host '  ============================================' -ForegroundColor Cyan
  Write-Host '    AI 学习平台  -  启动器' -ForegroundColor Cyan
  Write-Host '  ============================================' -ForegroundColor Cyan
  Write-Host ''
  Write-Host "  目录：$ProjectRoot"
  Write-Host ''
}

function Write-Ok   { param([string]$Text) Write-Host "  [√] $Text" -ForegroundColor Green }
function Write-Miss { param([string]$Text) Write-Host "  [×] $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "  [!] $Text" -ForegroundColor Yellow }
function Write-Info { param([string]$Text) Write-Host "      $Text" -ForegroundColor DarkGray }

function Write-Log {
  param([string]$Message)
  try {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $LogPath -Value "[$stamp] $Message" -Encoding UTF8
  } catch {
    # 日志失败不能影响启动
  }
}

# --------------------------------------------------------------------------
# 版本要求：唯一来源是 package.json 的 engines.node
# --------------------------------------------------------------------------
function Get-RequiredNodeMajor {
  $pkg = Join-Path $ProjectRoot 'package.json'
  if (Test-Path -LiteralPath $pkg) {
    try {
      $json = Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json
      $req = $null
      if ($json.PSObject.Properties.Name -contains 'engines' -and $json.engines) {
        $req = $json.engines.node
      }
      if ($req -and ($req -match '(\d+)')) { return [int]$Matches[1] }
    } catch {
      Write-Log "读取 package.json 的 engines 失败：$($_.Exception.Message)"
    }
  }
  return 20
}

# --------------------------------------------------------------------------
# 环境检测
# --------------------------------------------------------------------------
function Get-NodeInfo {
  $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  try {
    $raw = (& node --version 2>$null | Select-Object -First 1)
    if ($raw -and ($raw -match 'v?(\d+)\.(\d+)\.(\d+)')) {
      return [pscustomobject]@{
        Version = $raw.Trim()
        Major   = [int]$Matches[1]
        Path    = $cmd.Source
      }
    }
  } catch {
    Write-Log "执行 node --version 失败：$($_.Exception.Message)"
  }
  return $null
}

function Get-NpmInfo {
  $cmd = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  try {
    $raw = (& npm --version 2>$null | Select-Object -First 1)
    if ($raw) {
      return [pscustomobject]@{ Version = $raw.Trim(); Path = $cmd.Source }
    }
  } catch {
    Write-Log "执行 npm --version 失败：$($_.Exception.Message)"
  }
  return $null
}

# 安装 winget 之后，当前进程的 PATH 仍是旧的，需要重新从注册表读取。
function Update-ProcessPath {
  try {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
  } catch {
    Write-Log "刷新 PATH 失败：$($_.Exception.Message)"
  }
}

function Get-WingetPath {
  $cmd = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

# --------------------------------------------------------------------------
# 安装 Node.js（必须先得到用户确认）
# --------------------------------------------------------------------------
function Show-ManualInstallHint {
  Write-Host ''
  Write-Warn '请手动安装 Node.js：'
  Write-Info "官方下载页面：$NodeDownloadUrl"
  Write-Info '建议选择 LTS 版本。安装完成后重新运行本启动器即可。'
  Write-Host ''
}

function Install-NodeWithWinget {
  $winget = Get-WingetPath
  if (-not $winget) {
    Write-Host ''
    Write-Warn '本机没有检测到 winget，无法自动安装。'
    Show-ManualInstallHint
    return $false
  }

  Write-Host ''
  Write-Info "将执行：winget install --id $WingetNodeId --exact"
  Write-Info '安装过程可能弹出系统权限确认窗口，请在窗口中确认。'
  Write-Host ''
  $answer = Read-Host '  确认执行安装？[Y/N]'
  if ($answer -notmatch '^(y|yes|是)$') {
    Write-Host ''
    Write-Host '  已取消，未做任何改动。' -ForegroundColor DarkGray
    Write-Log '用户取消了 Node.js 安装'
    return $false
  }

  Write-Host ''
  Write-Host '  正在安装 Node.js，请稍候…' -ForegroundColor Cyan
  Write-Log "开始 winget 安装 $WingetNodeId"
  try {
    & $winget install --id $WingetNodeId --exact `
      --accept-source-agreements --accept-package-agreements
    $code = $LASTEXITCODE
  } catch {
    Write-Log "winget 执行异常：$($_.Exception.Message)"
    Write-Host ''
    Write-Warn "安装失败：$($_.Exception.Message)"
    return $false
  }

  if ($code -ne 0) {
    Write-Log "winget 返回非零退出码：$code"
    Write-Host ''
    Write-Warn "安装未成功（winget 退出码 $code）。"
    return $false
  }

  Write-Log 'winget 安装完成，准备重新检测'
  Update-ProcessPath
  return $true
}

# --------------------------------------------------------------------------
# 依赖
# --------------------------------------------------------------------------
function Test-DepsCurrent {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    return @{ ok = $false; reason = '尚未安装依赖' }
  }
  # npm 只在 Windows 上创建 .cmd 垫片；缺失说明这个 node_modules
  # 是在 macOS/Linux 上安装的，或安装已损坏。
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules\.bin\vite.cmd'))) {
    return @{ ok = $false; reason = '依赖是在其他操作系统上安装的'; clean = $true }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules\.package-lock.json'))) {
    return @{ ok = $false; reason = '依赖安装不完整'; clean = $true }
  }
  $lock = Join-Path $ProjectRoot 'package-lock.json'
  if (Test-Path -LiteralPath $lock) {
    $marker = Join-Path $ProjectRoot 'node_modules\.package-lock.json'
    try {
      if ((Get-Item -LiteralPath $lock).LastWriteTime -gt (Get-Item -LiteralPath $marker).LastWriteTime) {
        return @{ ok = $false; reason = '依赖已过期（package.json 有改动）' }
      }
    } catch {
      Write-Log "比较依赖时间戳失败：$($_.Exception.Message)"
    }
  }
  return @{ ok = $true }
}

function Install-Deps {
  param([switch]$Clean)

  if ($Clean) {
    Write-Info '正在移除旧的 node_modules（它是可再生的构建产物）…'
    try {
      Remove-Item -LiteralPath (Join-Path $ProjectRoot 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Log "删除 node_modules 失败：$($_.Exception.Message)"
    }
  }

  Write-Host ''
  Write-Host '  正在安装依赖，首次运行可能需要一两分钟…' -ForegroundColor Cyan
  Write-Host ''
  Write-Log '执行 npm install'
  try {
    & npm install
    $code = $LASTEXITCODE
  } catch {
    Write-Log "npm install 异常：$($_.Exception.Message)"
    Write-Host ''
    Write-Warn "依赖安装失败：$($_.Exception.Message)"
    Write-Info '常见处理：检查网络连接，删除 node_modules 后重新运行本启动器。'
    return $false
  }

  if ($code -ne 0) {
    Write-Log "npm install 返回非零退出码：$code"
    Write-Host ''
    Write-Warn "依赖安装失败（npm 退出码 $code）。"
    Write-Info '常见处理：检查网络连接，删除 node_modules 后重新运行本启动器。'
    return $false
  }

  Write-Log '依赖安装完成'
  return $true
}

# --------------------------------------------------------------------------
# 端口占用（IndexedDB 按来源隔离，端口必须固定）
# --------------------------------------------------------------------------
function Get-PortHolder {
  param([int]$Port)
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
  } catch {
    Write-Log "检测端口 $Port 失败：$($_.Exception.Message)"
  }
  return $null
}

function Ensure-PortFree {
  param([int]$Port)

  $holder = Get-PortHolder -Port $Port
  if (-not $holder) { return $true }

  Write-Host ''
  Write-Warn "端口 $Port 已被进程 $holder 占用。"
  Write-Info '通常是上一次没有关闭的开发服务器。'
  Write-Info "本应用必须使用端口 $Port，否则浏览器会把它当作另一个网站，"
  Write-Info '你会看到空的工作区（本地数据按来源隔离）。'
  Write-Host ''
  $answer = Read-Host '  结束该进程并继续？[Y/N]'
  if ($answer -notmatch '^(y|yes|是)$') {
    Write-Host ''
    Write-Host '  已取消，未结束任何进程。' -ForegroundColor DarkGray
    return $false
  }

  try {
    Stop-Process -Id $holder -Force -ErrorAction Stop
  } catch {
    Write-Host ''
    Write-Warn "无法结束进程 $holder：$($_.Exception.Message)"
    Write-Info '请以管理员身份重试，或手动关闭该进程。'
    return $false
  }

  # Windows 释放端口需要一点时间，重试而不是只等一次
  for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Milliseconds 800
    if (-not (Get-PortHolder -Port $Port)) {
      Write-Host "  端口 $Port 已释放。" -ForegroundColor Green
      return $true
    }
  }

  Write-Host ''
  Write-Warn "端口 $Port 仍被占用。"
  return $false
}

# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
function Main {
  Write-Banner
  Write-Log '启动器开始运行'

  $required = Get-RequiredNodeMajor
  Write-Host '  正在检查运行环境…'
  Write-Host ''

  # ---- Node.js ----
  $node = Get-NodeInfo
  if (-not $node) {
    Write-Miss 'Node.js：未检测到'
    Write-Host ''
    Write-Host '  本项目需要 Node.js 才能运行（用于启动本地开发服务器）。' -ForegroundColor White
    Write-Host '  本地课程文件与学习数据不会被上传。'
    Write-Host ''
    Write-Host '  [1] 安装 Node.js'
    Write-Host '  [2] 退出'
    Write-Host ''
    $choice = Read-Host '  请选择'
    if ($choice -ne '1') {
      Write-Host ''
      Write-Host '  已退出，未做任何改动。' -ForegroundColor DarkGray
      Write-Log '用户选择退出（未安装 Node.js）'
      return 1
    }

    if (-not (Install-NodeWithWinget)) {
      Write-Host ''
      Write-Warn 'Node.js 安装失败。'
      Write-Host '  [1] 重新尝试   [2] 查看安装说明   [3] 退出'
      Write-Host ''
      $again = Read-Host '  请选择'
      if ($again -eq '1') {
        if (-not (Install-NodeWithWinget)) {
          Show-ManualInstallHint
          Write-Log '第二次安装仍失败'
          return 1
        }
      } elseif ($again -eq '2') {
        Show-ManualInstallHint
        return 1
      } else {
        return 1
      }
    }

    # 安装后必须重新检测，不假设成功
    $node = Get-NodeInfo
    if (-not $node) {
      Write-Host ''
      Write-Warn '安装已完成，但当前窗口仍检测不到 Node.js。'
      Write-Info '请关闭本窗口，重新打开后再次运行启动器。'
      Write-Log '安装后重新检测仍失败'
      return 1
    }
    Write-Ok "Node.js：$($node.Version)（已安装）"
  } else {
    Write-Ok "Node.js：$($node.Version)"
  }

  # ---- 版本要求 ----
  if ($node.Major -lt $required) {
    Write-Host ''
    Write-Warn '检测到 Node.js，但当前版本过低。'
    Write-Info "当前版本：$($node.Version)"
    Write-Info "需要版本：$required.x 或更高"
    Write-Host ''
    Write-Host '  [1] 升级 Node.js'
    Write-Host '  [2] 退出'
    Write-Host ''
    $choice = Read-Host '  请选择'
    if ($choice -ne '1') {
      Write-Host ''
      Write-Host '  已退出，未做任何改动。' -ForegroundColor DarkGray
      Write-Log "用户拒绝升级（当前 $($node.Version)，需要 >=$required）"
      return 1
    }

    if (-not (Install-NodeWithWinget)) {
      Show-ManualInstallHint
      return 1
    }

    $node = Get-NodeInfo
    if (-not $node -or $node.Major -lt $required) {
      Write-Host ''
      Write-Warn '升级后版本仍不满足要求。'
      Show-ManualInstallHint
      Write-Log '升级后版本仍不满足'
      return 1
    }
    Write-Ok "Node.js：$($node.Version)（已升级）"
  }

  # ---- npm ----
  $npm = Get-NpmInfo
  if (-not $npm) {
    Write-Miss 'npm：未检测到'
    Write-Host ''
    Write-Warn 'npm 通常随 Node.js 一起安装。'
    Write-Info '请重新安装 Node.js（官方安装包已包含 npm），然后重试。'
    Show-ManualInstallHint
    Write-Log 'npm 未检测到'
    return 1
  }
  Write-Ok "npm：$($npm.Version)"

  # ---- 端口 ----
  if (-not (Ensure-PortFree -Port 5173)) {
    Write-Host ''
    Write-Warn '端口 5173 不可用，无法启动。'
    return 1
  }

  # ---- 依赖 ----
  $deps = Test-DepsCurrent
  if (-not $deps.ok) {
    Write-Info "依赖：$($deps.reason)"
    if (-not (Install-Deps -Clean:($deps.clean -eq $true))) {
      return 1
    }
  }
  Write-Ok '依赖：已就绪'

  # ---- 启动 ----
  Write-Host ''
  Write-Host '  正在启动开发服务器…' -ForegroundColor Cyan
  Write-Host ''
  Write-Host "  请始终使用同一个地址：$DevUrl"
  Write-Info '不要使用 "Network" 地址（它是另一个来源，会显示空工作区）。'
  Write-Host ''
  Write-Info '按 Ctrl+C 停止服务器。'
  Write-Host ''
  Write-Log '启动 npm run dev'

  try {
    & npm run dev -- --open
    $code = $LASTEXITCODE
  } catch {
    Write-Host ''
    Write-Warn "启动失败：$($_.Exception.Message)"
    Write-Log "npm run dev 异常：$($_.Exception.Message)"
    return 1
  }

  if ($code -ne 0) {
    Write-Host ''
    Write-Warn "开发服务器异常退出（退出码 $code）。"
    Write-Log "npm run dev 退出码：$code"
    return $code
  }

  Write-Host ''
  Write-Host '  服务器已停止。' -ForegroundColor DarkGray
  Write-Log '开发服务器正常停止'
  return 0
}

try {
  $exit = Main
} catch {
  Write-Host ''
  Write-Host "  [×] 启动器发生未预期的错误：$($_.Exception.Message)" -ForegroundColor Red
  Write-Log "未预期错误：$($_.Exception.ToString())"
  $exit = 1
}

Write-Host ''
Read-Host '  按回车键关闭此窗口' | Out-Null
exit $exit
