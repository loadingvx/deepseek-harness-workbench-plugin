#!/usr/bin/env bash
# 停掉占用 3080 的 dsh web，避免旧进程继续加载已改名的插件。
set -euo pipefail

PORT="${1:-3080}"

pids="$(ss -tlnp 2>/dev/null | awk -v port=":${PORT}" '$4 ~ port { print }' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
if [[ -z "$pids" ]]; then
  echo "端口 ${PORT} 上没有在跑的服务。"
  exit 0
fi

echo "正在停止端口 ${PORT} 上的进程：${pids}"
# shellcheck disable=SC2086
kill $pids 2>/dev/null || true
for _ in 1 2 3 4 5; do
  still="$(ss -tlnp 2>/dev/null | awk -v port=":${PORT}" '$4 ~ port { print }' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  [[ -z "$still" ]] && break
  sleep 0.4
done
still="$(ss -tlnp 2>/dev/null | awk -v port=":${PORT}" '$4 ~ port { print }' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
if [[ -n "$still" ]]; then
  echo "进程未退出，强制结束：${still}"
  # shellcheck disable=SC2086
  kill -9 $still 2>/dev/null || true
fi
echo "端口 ${PORT} 已释放。"
