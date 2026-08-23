#!/usr/bin/env bash
#
# sync-main-from-dev.sh
# 将 dev 分支的全部内容镜像到 main，并在 main 上额外提交 lib/ 构建产物。
#
# 分支约定:
#   dev  — 完整源码，lib/ 在 .gitignore 中不跟踪
#   main — 与 dev 内容一致 + 跟踪 lib/（供 GitHub 安装，无需用户侧构建）
#
# 特殊处理:
#   1. lib/ 目录 dev 不跟踪，main 需要其"现场"实际内容（构建产物）。
#      运行前请在 dev 分支执行 pnpm run build，或保证 main 工作区 lib/ 已是 dev 源码构建结果。
#      lib/client.js.map 不提交。
#   2. main 的 .gitignore 会去掉 lib 条目，使 lib/ 可被正常跟踪。
#
# 用法:
#   devops/sync-main-from-dev.sh [选项] [main分支] [dev分支]
#
# 选项:
#   -f, --fetch         先执行 git fetch origin（获取远端最新的 dev/main）
#   -m, --message MSG   自定义提交信息
#   -h, --help          显示本帮助
#
# 示例:
#   devops/sync-main-from-dev.sh
#   devops/sync-main-from-dev.sh -f
#   devops/sync-main-from-dev.sh -m "chore: 同步 dev 与 lib 到 main" main dev

set -euo pipefail

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

DO_FETCH=0
COMMIT_MSG=""

while getopts "fm:h" opt; do
  case "$opt" in
    f) DO_FETCH=1 ;;
    m) COMMIT_MSG="$OPTARG" ;;
    h) usage ;;
    *) usage 1 ;;
  esac
done
shift $((OPTIND - 1))

MAIN_BRANCH="${1:-main}"
DEV_BRANCH="${2:-dev}"

cd "$(git rev-parse --show-toplevel)"

# ---- 前置检查 ---------------------------------------------------------------
git rev-parse --verify --quiet "$MAIN_BRANCH" >/dev/null   || { echo "错误: 分支 $MAIN_BRANCH 不存在" >&2; exit 1; }
git rev-parse --verify --quiet "$DEV_BRANCH" >/dev/null   || { echo "错误: 分支 $DEV_BRANCH 不存在" >&2; exit 1; }
# main 必须是本地分支，避免在 origin/main 上产生游离提交
git show-ref --verify --quiet "refs/heads/$MAIN_BRANCH"   || { echo "错误: $MAIN_BRANCH 不是本地分支，无法提交" >&2; exit 1; }

# 现场 lib 备份目录（切换分支会被 main 旧版本覆盖，用完后清理）
LIB_BACKUP=""
cleanup() { [ -n "$LIB_BACKUP" ] && rm -rf "$LIB_BACKUP"; }
trap cleanup EXIT

if [ "$DO_FETCH" = "1" ]; then
  echo "==> git fetch origin"
  git fetch origin
  # main 保持本地分支提交；若本地落后于远端则尝试快进
  if [ "$(git branch --show-current)" != "$MAIN_BRANCH" ]; then
    git fetch origin "$MAIN_BRANCH:$MAIN_BRANCH" 2>/dev/null       || echo "==> 警告: 本地 $MAIN_BRANCH 无法快进到 origin/$MAIN_BRANCH（分叉），使用本地版本" >&2
  fi
  # 内容源优先用远端最新 dev
  git rev-parse --verify --quiet "origin/$DEV_BRANCH" >/dev/null && DEV_BRANCH="origin/$DEV_BRANCH"
fi

# 切换分支前：确认没有未提交的跟踪文件改动（避免 checkout -f 丢失工作）
if [ "$(git branch --show-current)" != "$MAIN_BRANCH" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "错误: 工作区有未提交的改动，请先提交或暂存 (git stash) 后再运行" >&2
    exit 1
  fi
  # 备份现场 lib（dev 不跟踪、main 需要其实际构建产物内容）
  if [ -d lib ]; then
    LIB_BACKUP="$(mktemp -d)"
    cp -a lib "$LIB_BACKUP/lib"
    echo "==> 已备份现场 lib 目录"
  fi
  echo "==> git checkout -f $MAIN_BRANCH"
  git checkout -f "$MAIN_BRANCH"
  # 恢复现场 lib（checkout 会用 main 旧版本覆盖 lib，换回现场实际内容）
  if [ -n "$LIB_BACKUP" ]; then
    rm -rf lib
    cp -a "$LIB_BACKUP/lib" lib
    echo "==> 已恢复现场 lib 目录"
  fi
fi

# ---- 1. 全量镜像 dev 跟踪的所有文件 -----------------------------------------
echo "==> 从 $DEV_BRANCH 检出全部跟踪文件"
git checkout "$DEV_BRANCH" -- .

# ---- 2. 移除 main 上有、dev 上没有的文件（保留 lib/）-----------------------
removed=()
while IFS= read -r f || [ -n "$f" ]; do
  case "$f" in
    lib/*) continue ;;
  esac
  if ! git cat-file -e "$DEV_BRANCH:$f" 2>/dev/null; then
    git rm -f -- "$f" 2>/dev/null || git rm -f --cached -- "$f" 2>/dev/null || true
    removed+=("$f")
  fi
done < <(git ls-files)

# ---- 3. main 的 .gitignore 去掉 lib，使 lib/ 可被正常跟踪 -------------------
if [ -f .gitignore ] && grep -qx 'lib' .gitignore; then
  grep -vx 'lib' .gitignore > .gitignore.tmp || true
  mv .gitignore.tmp .gitignore
  git add .gitignore
  echo "==> 已从 .gitignore 移除 lib（main 分支跟踪 lib/）"
fi

# ---- 4. lib 目录以现场构建产物为准 ------------------------------------------
if [ -d lib ]; then
  git add -A -- lib ':(exclude)lib/client.js.map'
else
  echo "警告: 工作区无 lib/ 目录。请先在 dev 分支执行 pnpm run build，再重新运行本脚本。" >&2
fi

# ---- 输出汇总 ---------------------------------------------------------------
# 勿用 read 变量名 `_`：bash 里 `$_` 是特殊参数，会与 `|| [ -n "$_" ]` 组合成死循环。
dev_count=0
while IFS= read -r entry; do
  dev_count=$((dev_count + 1))
done < <(git ls-tree -r --name-only "$DEV_BRANCH")

echo ""
echo "==> $DEV_BRANCH 跟踪 ${dev_count} 个文件，已全量镜像到 $MAIN_BRANCH"
if [ "${#removed[@]}" -gt 0 ]; then
  echo "==> 已移除 ${#removed[@]} 个 $MAIN_BRANCH 独有且 dev 不存在的文件:"
  printf '    %s\n' "${removed[@]}"
fi

# ---- 5. 提交 -----------------------------------------------------------------
if git diff --cached --quiet && git diff --quiet; then
  echo ""
  echo "==> 没有实际差异，无需提交。"
  exit 0
fi

if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="chore: sync $DEV_BRANCH tree and lib to $MAIN_BRANCH"
fi

echo ""
echo "==> git status --short:"
git status --short | head -50
status_lines=$(git status --short | wc -l)
if [ "$status_lines" -gt 50 ]; then
  echo "    ... 共 ${status_lines} 项变更"
fi
echo ""
git commit -m "$COMMIT_MSG"
echo ""
echo "==> 完成，提交: $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"
