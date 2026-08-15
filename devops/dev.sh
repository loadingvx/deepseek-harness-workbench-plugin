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

WEB_PKG="${HOME}/.dsh/profiles/web/package.json"
WEB_NM="${HOME}/.dsh/profiles/web/node_modules"

# 包名从 dsh-git-plugin 迁到 dsh-workbench-plugin 后，清掉旧条目和残留软链，
# 避免 profile 同时加载两份插件、client.js 只注册新名字。
if [[ -f "$WEB_PKG" ]] && grep -q '"dsh-git-plugin"' "$WEB_PKG"; then
  # shellcheck disable=SC2086
  eval $DSH_CMD plugin --profile web remove dsh-git-plugin || true
fi
if [[ -e "${WEB_NM}/dsh-git-plugin" || -L "${WEB_NM}/dsh-git-plugin" ]]; then
  rm -rf "${WEB_NM}/dsh-git-plugin"
fi

# shellcheck disable=SC2086
eval $DSH_CMD plugin --profile web add "$ROOT"

echo
echo "插件已安装到 web profile。正在启动 Web 界面…"
echo "浏览器打开 http://127.0.0.1:3080 →「对话」→ 标题栏右侧「工作台」。"
echo "改代码后重新执行本脚本，或先 devops/build.sh 再刷新页面。"
echo
exec bash "${ROOT}/devops/start-web.sh"
