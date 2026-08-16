#!/usr/bin/env bash
# 构建 Host 入口和浏览器 client.js。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

mise exec -- pnpm run build
if [[ ! -f "$ROOT/lib/index.js" || ! -f "$ROOT/lib/client.js" ]]; then
  echo "构建失败：缺少 lib/index.js 或 lib/client.js。应用市场的 github: 安装依赖这两份文件。" >&2
  exit 1
fi
echo "构建完成：lib/index.js 与 lib/client.js"
echo "推 GitHub 前请把这两份文件一并提交。市场命令 github:loadingvx/deepseek-harness-workbench-plugin 装的是仓库内容，不会在用户机器上编译。"
