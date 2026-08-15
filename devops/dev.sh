#!/usr/bin/env bash
# 构建插件、装进 web profile，并提示如何启动 Web UI。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

mise exec -- pnpm run build

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
  echo "找不到 dsh 命令。" >&2
  echo "请先安装 DeepSeek Harness（npx @deepseek-ai/dsh），或保证 deepseek-harness 已构建。" >&2
  exit 1
fi

# shellcheck disable=SC2086
eval $DSH_CMD plugin --profile web add "$ROOT"

echo
echo "插件已安装到 web profile。"
echo "请另开终端启动界面："
echo "  $DSH_CMD web"
echo "浏览器打开 http://127.0.0.1:3080 后，打开「对话」，看标题栏右侧的工作台图标。"
echo "改代码后请重新执行本脚本（或 devops/build.sh）再刷新页面。"
