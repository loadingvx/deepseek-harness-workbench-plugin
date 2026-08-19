#!/usr/bin/env bash
#
# sync-main-from-dev.sh
# 将 main 分支上当前仍存在的文件列表，用 dev 分支的最新版本覆盖更新，并提交到 main。
#
# 特殊处理:
#   1. lib/ 目录 dev 不跟踪（.gitignore），但 main 需要其"现场"实际内容（构建产物）。
#      因此 dev 中不存在的文件，若现场工作区存在则直接取现场内容提交；
#      lib/ 目录整体以现场为准（新增/修改/删除一并同步），
#      但 lib/client.js.map 排除（构建 map 文件不提交）。
#   2. docs/ 目录全量镜像 dev：新增、修改、删除都以 dev 的目录为准。
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
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
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

# ---- 1. 列出 main 当前仍存在的所有文件 -------------------------------------
mapfile -t files < <(git ls-tree -r --name-only "$MAIN_BRANCH")
echo "==> main 当前存在 ${#files[@]} 个文件"

# ---- 2. 更新: dev 有 → 取 dev 最新；dev 无但现场有 → 取现场（如 lib/） ------
updated=()
from_worktree=()
skipped=()
for f in "${files[@]}"; do
  case "$f" in
    docs/*) continue ;;   # docs 全量由下方镜像步骤处理，不在此循环
  esac
  if git cat-file -e "$DEV_BRANCH:$f" 2>/dev/null; then
    git checkout "$DEV_BRANCH" -- "$f"
    updated+=("$f")
  elif [ -e "$f" ]; then
    git add -f -- "$f"          # dev 不跟踪但现场存在（如 lib/*）→ 用现场版本
    from_worktree+=("$f")
  else
    skipped+=("$f")
  fi
done

# ---- 2.5 docs 全量镜像 dev（新增/修改/删除均以 dev 为准） -------------------
docs_removed=()
docs_new=()
if git ls-tree -r --name-only "$DEV_BRANCH" -- docs | grep -q .; then
  # dev 有 docs：全量取 dev 版本（含 dev 新增的文档）
  git checkout "$DEV_BRANCH" -- docs
  # main 上有而 dev 没有的 docs 文件 → 删除（保证目录与 dev 完全一致）
  mapfile -t stale_docs < <(comm -23     <(git ls-tree -r --name-only "$MAIN_BRANCH" -- docs | sort)     <(git ls-tree -r --name-only "$DEV_BRANCH" -- docs | sort))
  if [ "${#stale_docs[@]}" -gt 0 ]; then
    git rm -r --quiet --ignore-unmatch -- "${stale_docs[@]}"
    docs_removed=("${stale_docs[@]}")
  fi
  # dev 有而 main 没有的 docs 文件 → 新增（用于统计）
  mapfile -t new_docs < <(comm -13     <(git ls-tree -r --name-only "$MAIN_BRANCH" -- docs | sort)     <(git ls-tree -r --name-only "$DEV_BRANCH" -- docs | sort))
  docs_new=("${new_docs[@]}")
else
  # dev 完全没有 docs → main 上也移除整个 docs 目录
  git rm -r --quiet --ignore-unmatch -- docs
  mapfile -t docs_removed < <(git ls-tree -r --name-only "$MAIN_BRANCH" -- docs)
fi

# lib 目录整体以现场为准: 新增、删除、修改一并纳入
# 排除 lib/client.js.map（构建 map 文件不提交）
if [ -d lib ]; then
  git add -A -f -- lib ':(exclude)lib/client.js.map'
fi

# ---- 输出汇总 ---------------------------------------------------------------
echo ""
echo "==> 已从 $DEV_BRANCH 更新 ${#updated[@]} 个文件:"
printf '    %s\n' "${updated[@]}"
if [ "${#from_worktree[@]}" -gt 0 ]; then
  echo ""
  echo "==> ${#from_worktree[@]} 个文件 dev 不跟踪，使用现场实际内容（lib）:"
  printf '    %s\n' "${from_worktree[@]}"
fi
if [ "${#docs_new[@]}" -gt 0 ]; then
  echo ""
  echo "==> docs 全量镜像 dev，新增 ${#docs_new[@]} 个文档:"
  printf '    %s\n' "${docs_new[@]}"
fi
if [ "${#docs_removed[@]}" -gt 0 ]; then
  echo ""
  echo "==> docs 全量镜像 dev，删除 ${#docs_removed[@]} 个 main 独有文档:"
  printf '    %s\n' "${docs_removed[@]}"
fi
if [ "${#skipped[@]}" -gt 0 ]; then
  echo ""
  echo "==> 以下 ${#skipped[@]} 个文件 dev 中不存在且现场也不存在，保持 main 原样:"
  printf '    %s\n' "${skipped[@]}"
fi

# ---- 3. 提交 -----------------------------------------------------------------
if git diff --cached --quiet; then
  echo ""
  echo "==> 没有实际差异，无需提交。"
  exit 0
fi

if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="chore: sync $DEV_BRANCH compiled lib and docs to $MAIN_BRANCH"
fi

echo ""
echo "==> git status --short:"
git status --short
echo ""
git commit -m "$COMMIT_MSG"
echo ""
echo "==> 完成，提交: $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"
