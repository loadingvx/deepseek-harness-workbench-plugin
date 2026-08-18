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

# shellcheck source=find-dsh.sh
source "${ROOT}/devops/find-dsh.sh"
if ! DSH_CMD="$(find_dsh)"; then
  explain_dsh_missing
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

# Ultra Slash 已并入本插件。旧的独立包若还留在 profile 里，会抢同一套
# / 命令和 locale，工作台会报「ultra-slash already has locale zh」然后整包加载失败。
if [[ -f "$WEB_PKG" ]] && grep -q '"deepseek-harness-ultra-slash"' "$WEB_PKG"; then
  # shellcheck disable=SC2086
  eval $DSH_CMD plugin --profile web remove deepseek-harness-ultra-slash || true
fi
if [[ -e "${WEB_NM}/deepseek-harness-ultra-slash" || -L "${WEB_NM}/deepseek-harness-ultra-slash" ]]; then
  rm -rf "${WEB_NM}/deepseek-harness-ultra-slash"
fi

# shellcheck disable=SC2086
eval $DSH_CMD plugin --profile web add "$ROOT"

echo
echo "插件已安装到 web profile。正在启动 Web 界面…"
echo "浏览器打开 http://127.0.0.1:3080 →「对话」→ 新建会话，工作台会自动打开。"
echo "改代码后重新执行本脚本，或先 devops/build.sh 再刷新页面。"
echo
exec bash "${ROOT}/devops/start-web.sh"
