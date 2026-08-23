#!/usr/bin/env bash
# 用 mise 的 Node 24 编译 ./deepseek-harness 软链。不要用系统 Node 22.14，否则 tsdown 会报 unrun。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="${ROOT}/deepseek-harness"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

if [[ ! -e "${HARNESS}" ]]; then
  echo "没有 ${HARNESS}。请先把 deepseek-harness 源码软链到插件仓库根目录：" >&2
  echo "  ln -s ../deepseek-harness ${HARNESS}" >&2
  exit 1
fi

cd "${HARNESS}"
mise trust "${HARNESS}/mise.toml" >/dev/null 2>&1 || mise trust "${HARNESS}/.mise.toml" >/dev/null 2>&1 || true
echo "正在用 mise 的 Node 安装并编译 DeepSeek Harness（目录：${HARNESS}）…"
mise exec -- node -e "console.log('Node ' + process.version)"
mise exec -- pnpm install
mise exec -- pnpm run build

if [[ ! -f "${HARNESS}/apps/cli/lib/bin.js" ]]; then
  echo "编译结束，但还是没有 apps/cli/lib/bin.js。请把完整终端输出发出来。" >&2
  exit 1
fi

echo "harness 已编译。接下来可以执行：bash devops/dev.sh"
