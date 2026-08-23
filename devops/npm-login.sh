#!/usr/bin/env bash
# 登录 npm 官方源。Linux / macOS / WSL 通用；不读写、不打印账号密码。
# 发包装的是 registry.npmjs.org，和 ~/.npmrc 里的淘宝镜像无关。
set -euo pipefail

REGISTRY="https://registry.npmjs.org"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

os="$(uname -s)"
echo "正在检查能否连上 npm 官方源（${REGISTRY}）…"

probe_registry() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  local code
  code="$(curl -sS -o /dev/null -m 10 --connect-timeout 8 -w '%{http_code}' "$REGISTRY" || true)"
  case "$code" in
    2*|3*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! probe_registry; then
  echo "本机 8 秒内连不上 npm 官方源，登录会一直转圈然后超时。" >&2
  echo "这不是账号密码错，是网络到不了 registry.npmjs.org。" >&2
  echo "请先让浏览器能打开 https://www.npmjs.com ，再重新执行本脚本。" >&2
  echo "日常安装可以用淘宝镜像；登录和发布必须走官方源。" >&2
  exit 1
fi

# npm 11 会打开浏览器做网页登录。Cursor 内置终端经常弹不出窗口。
case "$os" in
  Darwin)
    export BROWSER="${BROWSER:-open}"
    echo "macOS：将用系统浏览器打开 npm 登录页。"
    echo "若没有弹出窗口，请到「终端.app」里再执行本脚本。"
    ;;
  Linux)
    if [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]]; then
      export BROWSER="${BROWSER:-true}"
      echo "WSL：将尝试打开 Windows 那边的浏览器。"
    elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null 2>&1; then
      export BROWSER="${BROWSER:-xdg-open}"
    fi
    ;;
esac

echo "开始登录 ${REGISTRY} …"
mise exec -- npm login --registry="$REGISTRY"
echo "登录成功。接下来可以执行：bash devops/release.sh"
