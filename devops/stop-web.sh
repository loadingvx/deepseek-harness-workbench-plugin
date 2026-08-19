#!/usr/bin/env bash
# 停掉占用指定端口的 dsh web，避免旧进程继续加载已改名的插件。
# macOS 没有 ss，用 lsof；Linux 优先 lsof，没有再用 ss。
set -euo pipefail

PORT="${1:-3080}"

# 打印监听该 TCP 端口的 PID，每行一个。找不到工具时输出为空。
listening_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null \
      | awk -v port=":${port}" '$4 ~ port { print }' \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 \
      | sort -u || true
    return 0
  fi
  echo "停服务需要 lsof（macOS / 多数 Linux）或 ss（iproute2）。当前 PATH 里都没有。" >&2
  return 1
}

pids="$(listening_pids "$PORT")"
if [[ -z "$pids" ]]; then
  echo "端口 ${PORT} 上没有在跑的服务。"
  exit 0
fi

echo "正在停止端口 ${PORT} 上的进程：$(echo "$pids" | tr '\n' ' ')"
# shellcheck disable=SC2086
kill $pids 2>/dev/null || true
for _ in 1 2 3 4 5; do
  still="$(listening_pids "$PORT")"
  [[ -z "$still" ]] && break
  sleep 0.4
done
still="$(listening_pids "$PORT")"
if [[ -n "$still" ]]; then
  echo "进程未退出，强制结束：$(echo "$still" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -9 $still 2>/dev/null || true
fi
echo "端口 ${PORT} 已释放。"
