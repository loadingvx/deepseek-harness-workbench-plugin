#!/usr/bin/env bash
# 运行 GitService 的本地仓库夹具测试。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "测试需要系统 git，当前 PATH 里没有。" >&2
  exit 1
fi

mise exec -- pnpm test
