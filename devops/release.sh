#!/usr/bin/env bash
# 把当前包发到 npm 官方源。只用本机已有的登录态，不读写、不打印账号密码或 token。
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
用法：
  bash devops/release.sh              发布 package.json 里的当前版本
  bash devops/release.sh patch        先把版本 +0.0.1 再发布
  bash devops/release.sh minor        先把版本 +0.1.0 再发布
  bash devops/release.sh major        先把版本 +1.0.0 再发布
  bash devops/release.sh --dry-run    只演练，不真正发布

不会把账号、密码、token 写进仓库或打到终端。
发布前请先在本机登录官方源（Linux / macOS / WSL 都用这一条）：
  bash devops/npm-login.sh
EOF
}

DRY_RUN=0
BUMP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    patch|minor|major)
      if [[ -n "$BUMP" ]]; then
        echo "只能指定一次版本递增：patch / minor / major。" >&2
        exit 1
      fi
      BUMP="$1"
      shift
      ;;
    *)
      echo "不认识的参数：$1" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v mise >/dev/null 2>&1; then
  echo "未找到 mise。请先运行 devops/setup.sh" >&2
  exit 1
fi

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "找不到 package.json，请在仓库根目录执行本脚本。" >&2
  exit 1
fi

echo "正在检查官方源登录状态（${REGISTRY}）…"
WHOAMI_OUT="$(mise exec -- npm whoami --registry="$REGISTRY" 2>&1)" || WHOAMI_ST=$?
WHOAMI_ST="${WHOAMI_ST:-0}"
USERNAME="$(printf '%s\n' "$WHOAMI_OUT" | grep -vE '^npm |^npm$' | tail -n 1 | tr -d '\r' || true)"
if [[ "$WHOAMI_ST" -ne 0 ]]; then
  if printf '%s' "$WHOAMI_OUT" | grep -qE 'ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network request'; then
    echo "连不上 npm 官方源，所以没法确认登录态，也发不了包。" >&2
    echo "这不是账号没登，是本机到不了 ${REGISTRY}。" >&2
  else
    echo "还没有登录 npm 官方源，发不了包。" >&2
  fi
  echo "请先执行（不要把账号密码写进脚本或发给别人）：" >&2
  echo "  bash ${ROOT}/devops/npm-login.sh" >&2
  echo "登录成功后再重新执行本脚本。" >&2
  exit 1
fi
if [[ -z "$USERNAME" || "$USERNAME" == *"error"* || "$USERNAME" == *"ENEEDAUTH"* ]]; then
  echo "读取 npm 登录态失败。请重新登录官方源后再试。" >&2
  echo "  bash ${ROOT}/devops/npm-login.sh" >&2
  exit 1
fi
echo "将使用本机已登录的 npm 账号发布（账号名：${USERNAME}）。"

if [[ -n "$BUMP" ]]; then
  echo "正在把版本递增一档：$BUMP"
  mise exec -- npm version "$BUMP" --no-git-tag-version
fi

NAME="$(mise exec -- node -p "require('./package.json').name")"
VERSION="$(mise exec -- node -p "require('./package.json').version")"
if [[ -z "$NAME" || -z "$VERSION" ]]; then
  echo "package.json 里缺少 name 或 version。" >&2
  exit 1
fi

echo "准备发布：${NAME}@${VERSION}"
echo "发布源：${REGISTRY}"

if mise exec -- npm view "$NAME@$VERSION" version --registry="$REGISTRY" >/dev/null 2>&1; then
  echo "$NAME@$VERSION 已经在 npm 上了，同一版本不能重复发布。" >&2
  echo "请改 package.json 的 version，或执行：" >&2
  echo "  bash devops/release.sh patch" >&2
  exit 1
fi

echo "正在跑测试…"
mise exec -- pnpm test
echo "正在构建…"
mise exec -- pnpm run build

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "演练发布（不会上传）…"
  mise exec -- npm publish --dry-run --registry="$REGISTRY"
  echo
  echo "演练完成，没有真正发布。"
  echo "确认无误后执行：bash devops/release.sh"
  exit 0
fi

echo "正在发布到 ${REGISTRY} …"
mise exec -- npm publish --registry="$REGISTRY"

echo
echo "已发布 ${NAME}@${VERSION}"
echo "安装："
echo "  dsh plugin --profile web add $NAME@$VERSION"
echo "页面：https://www.npmjs.com/package/$NAME"
