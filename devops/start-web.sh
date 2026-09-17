#!/usr/bin/env bash
# 停掉旧的 3080，再启动 dsh web。前台运行，Ctrl+C 结束。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-3080}"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

# shellcheck source=find-dsh.sh
source "${ROOT}/devops/find-dsh.sh"
if ! DSH_CMD="$(find_dsh)"; then
  explain_dsh_missing
  exit 1
fi

bash "${ROOT}/devops/stop-web.sh" "$PORT"

WEB_PKG="${HOME}/.dsh/profiles/web/package.json"
if [[ ! -f "$WEB_PKG" ]] || ! grep -q '"dsh-workbench-plugin"' "$WEB_PKG"; then
  echo "web profile 未注册 dsh-workbench-plugin：底部 StatusBar、Git、终端、浏览器等都不会加载。" >&2
  echo "只跑 devops/build.sh 不会把插件装进 profile；请先执行：" >&2
  echo "  bash devops/dev.sh" >&2
  exit 1
fi

echo "正在启动 Web 界面：http://127.0.0.1:${PORT}"
echo "打开「对话」后，点标题栏右侧的工作台图标。终端页是本机真伪终端。"
echo "按 Ctrl+C 停止服务。"
# shellcheck disable=SC2086
exec $DSH_CMD web
