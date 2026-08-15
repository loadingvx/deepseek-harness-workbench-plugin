#!/usr/bin/env bash
# 安装本仓库的 Node / pnpm，并装好插件依赖。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先在本机安装 mise：https://mise.jdx.dev/" >&2
  exit 1
fi

mise trust "$ROOT/.mise.toml" >/dev/null
mise install

if ! command -v git >/dev/null 2>&1; then
  echo "警告：当前 PATH 里没有 git。插件面板和工具都需要系统 git，请先安装后再使用。" >&2
fi

mise exec -- pnpm install
echo "开发环境已就绪。接下来可以执行：devops/build.sh"
