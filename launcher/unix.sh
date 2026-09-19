#!/usr/bin/env bash
#
# AI 学习平台 — macOS / Linux 启动器
#
# 职责（仅系统环境管理）：
#   1. 检测 Node.js 是否存在、版本是否满足 package.json 的 engines 要求
#   2. 检测 npm 是否可用
#   3. 缺少或版本过低时，先询问用户，得到确认后才尝试安装
#   4. 安装后重新检测，不假设成功
#   5. 检查依赖是否完整，必要时安装
#   6. 启动开发服务器
#
# 隐私：只检测 Node.js / npm / 操作系统版本。不收集用户名、硬件、网络或文件信息，
#       无遥测，无上报。
# 安全：不静默安装；不自动安装 Homebrew；不提权（sudo 由系统提示，本脚本不保存密码）；
#       不下载第三方安装包；日志不含任何密钥。

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

DEV_URL="http://localhost:5173"
PORT=5173
NODE_DOWNLOAD_URL="https://nodejs.org/zh-cn/download"
LOG_FILE="$PROJECT_ROOT/launcher/launcher.log"

# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_GRAY=$'\033[90m'; C_RED=$'\033[31m'; C_WHITE=$'\033[97m'
else
  C_RESET=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_GRAY=''; C_RED=''; C_WHITE=''
fi

log() {
  # 只写诊断信息，绝不写任何密钥
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

banner() {
  printf '\n%s  ============================================%s\n' "$C_CYAN" "$C_RESET"
  printf '%s    AI 学习平台  -  启动器%s\n' "$C_CYAN" "$C_RESET"
  printf '%s  ============================================%s\n\n' "$C_CYAN" "$C_RESET"
  printf '  目录：%s\n\n' "$PROJECT_ROOT"
}

ok()   { printf '%s  [√] %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
miss() { printf '%s  [×] %s%s\n' "$C_GRAY" "$1" "$C_RESET"; }
warn() { printf '%s  [!] %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
info() { printf '%s      %s%s\n' "$C_GRAY" "$1" "$C_RESET"; }
err()  { printf '%s  [×] %s%s\n' "$C_RED" "$1" "$C_RESET"; }

confirm() {
  # $1 = 提示文字。返回 0 表示用户确认。
  printf '\n%s\n' "$1"
  printf '  确认执行？[y/N] '
  local answer
  read -r answer || return 1
  case "$answer" in
    y|Y|yes|YES|是) return 0 ;;
    *) return 1 ;;
  esac
}

# --------------------------------------------------------------------------
# 版本要求：唯一来源是 package.json 的 engines.node
# 用 sed 解析，因为此时 Node.js 可能还不存在
# --------------------------------------------------------------------------
required_node_major() {
  local v=''
  if [ -f package.json ]; then
    v=$(sed -n 's/.*"node"[[:space:]]*:[[:space:]]*"[^0-9]*\([0-9][0-9]*\).*/\1/p' package.json 2>/dev/null | head -n1)
  fi
  if [ -n "$v" ]; then printf '%s\n' "$v"; else printf '20\n'; fi
}

# --------------------------------------------------------------------------
# 环境检测
# --------------------------------------------------------------------------
node_version() {
  command -v node >/dev/null 2>&1 || return 1
  node --version 2>/dev/null
}

node_major() {
  local raw
  raw="$(node_version)" || return 1
  printf '%s' "${raw#v}" | cut -d. -f1
}

npm_version() {
  command -v npm >/dev/null 2>&1 || return 1
  npm --version 2>/dev/null
}

# --------------------------------------------------------------------------
# 安装 Node.js（必须先得到用户确认）
# --------------------------------------------------------------------------
manual_install_hint() {
  printf '\n'
  warn '请手动安装 Node.js：'
  info "官方下载页面：$NODE_DOWNLOAD_URL"
  info '建议选择 LTS 版本。'
  info 'macOS 也可以使用 Homebrew：brew install node'
  info 'Linux 也可以使用发行版包管理器，或 nvm（https://github.com/nvm-sh/nvm）'
  printf '\n'
}

install_node_macos() {
  if command -v brew >/dev/null 2>&1; then
    if confirm '将执行：brew install node'; then
      log 'brew install node'
      brew install node
      return $?
    fi
    log '用户取消了 brew 安装'
    return 1
  fi
  warn '未检测到 Homebrew，不会自动安装它。'
  manual_install_hint
  return 1
}

install_node_linux() {
  # 按发行版选择包管理器；无法确定时给出官方说明
  if command -v apt-get >/dev/null 2>&1; then
    if confirm '将执行：sudo apt-get install -y nodejs npm（可能需要管理员权限）'; then
      log 'apt-get install nodejs npm'
      sudo apt-get install -y nodejs npm
      return $?
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if confirm '将执行：sudo dnf install -y nodejs npm（可能需要管理员权限）'; then
      log 'dnf install nodejs npm'
      sudo dnf install -y nodejs npm
      return $?
    fi
  elif command -v pacman >/dev/null 2>&1; then
    if confirm '将执行：sudo pacman -S --noconfirm nodejs npm（可能需要管理员权限）'; then
      log 'pacman -S nodejs npm'
      sudo pacman -S --noconfirm nodejs npm
      return $?
    fi
  elif command -v zypper >/dev/null 2>&1; then
    if confirm '将执行：sudo zypper install -y nodejs npm（可能需要管理员权限）'; then
      log 'zypper install nodejs npm'
      sudo zypper install -y nodejs npm
      return $?
    fi
  else
    warn '无法确定当前发行版的安全安装方式。'
    manual_install_hint
    return 1
  fi
  log '用户取消了安装'
  return 1
}

install_node() {
  case "$(uname -s)" in
    Darwin) install_node_macos ;;
    Linux)  install_node_linux ;;
    *)
      warn "未支持的操作系统：$(uname -s)"
      manual_install_hint
      return 1
      ;;
  esac
}

# --------------------------------------------------------------------------
# 依赖
# --------------------------------------------------------------------------
deps_status() {
  # 输出：ok / missing / foreign / incomplete / stale
  [ -d node_modules ] || { printf 'missing\n'; return; }
  [ -x node_modules/.bin/vite ] || { printf 'foreign\n'; return; }
  [ -f node_modules/.package-lock.json ] || { printf 'incomplete\n'; return; }
  if [ -f package-lock.json ] && [ package-lock.json -nt node_modules/.package-lock.json ]; then
    printf 'stale\n'
    return
  fi
  printf 'ok\n'
}

install_deps() {
  local clean="$1"

  if [ "$clean" = "yes" ]; then
    info '正在移除旧的 node_modules（它是可再生的构建产物）…'
    rm -rf node_modules 2>/dev/null || true
  fi

  printf '\n%s  正在安装依赖，首次运行可能需要一两分钟…%s\n\n' "$C_CYAN" "$C_RESET"
  log 'npm install'
  if npm install; then
    log '依赖安装完成'
    return 0
  fi
  warn '依赖安装失败。'
  info '常见处理：检查网络连接，删除 node_modules 后重新运行本启动器。'
  return 1
}

# --------------------------------------------------------------------------
# 端口（IndexedDB 按来源隔离，端口必须固定）
# --------------------------------------------------------------------------
port_holder() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n1
  elif command -v ss >/dev/null 2>&1; then
    ss -lptnH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n1 | cut -d= -f2
  fi
}

ensure_port_free() {
  local holder
  holder="$(port_holder "$PORT")"
  [ -z "$holder" ] && return 0

  warn "端口 $PORT 已被进程 $holder 占用。"
  info '通常是上一次没有关闭的开发服务器。'
  info "本应用必须使用端口 $PORT，否则浏览器会把它当作另一个网站，"
  info '你会看到空的工作区（本地数据按来源隔离）。'

  if confirm '结束该进程并继续？'; then
    kill "$holder" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do
      sleep 0.8
      if [ -z "$(port_holder "$PORT")" ]; then
        printf '%s  端口 %s 已释放。%s\n' "$C_GREEN" "$PORT" "$C_RESET"
        return 0
      fi
    done
    warn "端口 $PORT 仍被占用。"
    return 1
  fi
  printf '%s  已取消，未结束任何进程。%s\n' "$C_GRAY" "$C_RESET"
  return 1
}

# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
main() {
  banner
  log '启动器开始运行'

  local required
  required="$(required_node_major)"

  printf '  正在检查运行环境…\n\n'

  # ---- Node.js ----
  local raw major
  raw="$(node_version)" || raw=''

  if [ -z "$raw" ]; then
    miss 'Node.js：未检测到'
    printf '\n%s  本项目需要 Node.js 才能运行（用于启动本地开发服务器）。%s\n' "$C_WHITE" "$C_RESET"
    printf '  本地课程文件与学习数据不会被上传。\n\n'
    printf '  [1] 安装 Node.js\n'
    printf '  [2] 退出\n\n'
    printf '  请选择：'
    local choice
    read -r choice || choice=''
    if [ "$choice" != '1' ]; then
      printf '\n%s  已退出，未做任何改动。%s\n' "$C_GRAY" "$C_RESET"
      log '用户选择退出（未安装 Node.js）'
      return 1
    fi

    if ! install_node; then
      err 'Node.js 安装失败。'
      manual_install_hint
      return 1
    fi

    raw="$(node_version)" || raw=''
    if [ -z "$raw" ]; then
      warn '安装已完成，但当前 shell 仍检测不到 Node.js。'
      info '请关闭本终端，重新打开后再次运行启动器。'
      log '安装后重新检测仍失败'
      return 1
    fi
    ok "Node.js：$raw（已安装）"
  else
    ok "Node.js：$raw"
  fi

  # ---- 版本要求 ----
  major="$(node_major)" || major=0
  if [ "$major" -lt "$required" ] 2>/dev/null; then
    printf '\n'
    warn '检测到 Node.js，但当前版本过低。'
    info "当前版本：$raw"
    info "需要版本：${required}.x 或更高"
    printf '\n  [1] 升级 Node.js\n  [2] 退出\n\n  请选择：'
    local c2
    read -r c2 || c2=''
    if [ "$c2" != '1' ]; then
      printf '\n%s  已退出，未做任何改动。%s\n' "$C_GRAY" "$C_RESET"
      log "用户拒绝升级（当前 $raw，需要 >=$required）"
      return 1
    fi

    if ! install_node; then
      manual_install_hint
      return 1
    fi

    raw="$(node_version)" || raw=''
    major="$(node_major)" || major=0
    if [ -z "$raw" ] || [ "$major" -lt "$required" ] 2>/dev/null; then
      warn '升级后版本仍不满足要求。'
      manual_install_hint
      log '升级后版本仍不满足'
      return 1
    fi
    ok "Node.js：$raw（已升级）"
  fi

  # ---- npm ----
  local npmv
  npmv="$(npm_version)" || npmv=''
  if [ -z "$npmv" ]; then
    miss 'npm：未检测到'
    printf '\n'
    warn 'npm 通常随 Node.js 一起安装。'
    info '请重新安装 Node.js（官方安装包已包含 npm），然后重试。'
    manual_install_hint
    log 'npm 未检测到'
    return 1
  fi
  ok "npm：$npmv"

  # ---- 端口 ----
  if ! ensure_port_free; then
    warn '端口 5173 不可用，无法启动。'
    return 1
  fi

  # ---- 依赖 ----
  local status
  status="$(deps_status)"
  case "$status" in
    ok) : ;;
    missing)    info '依赖：尚未安装' ;;
    foreign)    info '依赖：是在其他操作系统上安装的' ;;
    incomplete) info '依赖：安装不完整' ;;
    stale)      info '依赖：已过期（package.json 有改动）' ;;
  esac
  if [ "$status" != 'ok' ]; then
    local clean='no'
    case "$status" in foreign|incomplete) clean='yes' ;; esac
    if ! install_deps "$clean"; then
      return 1
    fi
  fi
  ok '依赖：已就绪'

  # ---- 启动 ----
  printf '\n%s  正在启动开发服务器…%s\n\n' "$C_CYAN" "$C_RESET"
  printf '  请始终使用同一个地址：%s\n' "$DEV_URL"
  info '不要使用 "Network" 地址（它是另一个来源，会显示空工作区）。'
  printf '\n'
  info '按 Ctrl+C 停止服务器。'
  printf '\n'
  log '启动 npm run dev'

  npm run dev -- --open
  local code=$?
  if [ "$code" -ne 0 ]; then
    warn "开发服务器异常退出（退出码 $code）。"
    log "npm run dev 退出码：$code"
    return "$code"
  fi
  printf '\n%s  服务器已停止。%s\n' "$C_GRAY" "$C_RESET"
  log '开发服务器正常停止'
  return 0
}

main
exit $?
