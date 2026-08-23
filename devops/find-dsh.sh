# 由 devops/*.sh source。成功时把启动命令打到 stdout。
# 依赖调用方已设置 ROOT 为插件仓库根目录。

find_dsh() {
  if command -v dsh >/dev/null 2>&1; then
    command -v dsh
    return 0
  fi
  if [[ -x "${HOME}/.dsh/profiles/node_modules/.bin/dsh" ]]; then
    echo "${HOME}/.dsh/profiles/node_modules/.bin/dsh"
    return 0
  fi
  if [[ -f "${HOME}/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js" ]]; then
    echo "mise exec -- node ${HOME}/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js"
    return 0
  fi
  if [[ -f "${ROOT}/deepseek-harness/apps/cli/lib/bin.js" ]]; then
    echo "mise exec -- node ${ROOT}/deepseek-harness/apps/cli/lib/bin.js"
    return 0
  fi
  return 1
}

explain_dsh_missing() {
  echo "找不到可用的 dsh，所以插件还没法装进 Web 界面。" >&2
  echo >&2
  if [[ -e "${ROOT}/deepseek-harness" || -L "${ROOT}/deepseek-harness" ]]; then
    if [[ ! -f "${ROOT}/deepseek-harness/apps/cli/lib/bin.js" ]]; then
      echo "已经有 ./deepseek-harness 软链，但那是源码仓库，还没有编译产物。" >&2
      echo "脚本要的是 apps/cli/lib/bin.js，软链本身不能当安装。" >&2
      echo "请先构建一次（改 harness 源码后也要再编）。必须用 mise 的 Node 24，不要用系统自带的 Node 22.14：" >&2
      echo "  bash ${ROOT}/devops/build-harness.sh" >&2
      echo "编完后再执行：bash devops/dev.sh" >&2
      echo >&2
      echo "如果出现 Failed to import module \"unrun\"：说明当时没用 mise，tsdown 在旧 Node 上会去找未安装的 unrun。" >&2
      echo "不要只敲 npx @deepseek-ai/dsh：不带 --profile 会报「--profile 必填」，" >&2
      echo "那是命令用法，不代表没装上，也不会把 dsh 写进 PATH。" >&2
      return 0
    fi
  fi
  echo "本机 PATH 和 ~/.dsh 里都没有 dsh。" >&2
  echo "任选一种：" >&2
  echo "  1）把 deepseek-harness 源码软链到本仓库根目录并编译（见上）。" >&2
  echo "  2）用 mise 的 Node 全局安装 CLI：" >&2
  echo "       mise exec -- npm install -g @deepseek-ai/dsh" >&2
  echo "     临时试跑必须带 profile，例如：" >&2
  echo "       mise exec -- npx @deepseek-ai/dsh --profile web" >&2
}
