#!/usr/bin/env bash
# 停掉旧的 3080，再启动 dsh web。前台运行，Ctrl+C 结束。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-3080}"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

find_dsh() {
  if command -v dsh >/dev/null 2>&1; then
    command -v dsh
    return
  fi
  if [[ -x "${HOME}/.dsh/profiles/node_modules/.bin/dsh" ]]; then
    echo "${HOME}/.dsh/profiles/node_modules/.bin/dsh"
    return
  fi
  if [[ -f "${HOME}/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js" ]]; then
    echo "mise exec -- node ${HOME}/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js"
    return
  fi
  if [[ -f "${ROOT}/deepseek-harness/apps/cli/lib/bin.js" ]]; then
    echo "mise exec -- node ${ROOT}/deepseek-harness/apps/cli/lib/bin.js"
    return
  fi
  return 1
}

if ! DSH_CMD="$(find_dsh)"; then
  echo "找不到 dsh 命令。请先安装 DeepSeek Harness。" >&2
  exit 1
fi

bash "${ROOT}/devops/stop-web.sh" "$PORT"

echo "正在启动 Web 界面：http://127.0.0.1:${PORT}"
echo "打开「对话」后，点标题栏右侧的工作台图标。终端页是本机真伪终端。"
echo "按 Ctrl+C 停止服务。"
# shellcheck disable=SC2086
exec $DSH_CMD web
