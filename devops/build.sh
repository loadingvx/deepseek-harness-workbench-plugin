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
echo "构建完成：lib/index.js 与 lib/client.js"
