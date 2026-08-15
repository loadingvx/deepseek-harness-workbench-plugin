import type { GitErrorCode, GitFail } from './types.ts'

const COPY: Record<GitErrorCode, { messageZh: string; hintZh: string }> = {
  GIT_NOT_FOUND: {
    messageZh: '本机没有可用的 git 命令。',
    hintZh: '请先安装 Git，并确认终端里执行 `git --version` 能成功。Debian/Ubuntu 可用 `sudo apt install git`。',
  },
  NOT_A_REPO: {
    messageZh: '当前工作区不是 Git 仓库。',
    hintZh: '请在仓库根目录打开工作区。本插件不会自动执行 git init，以免误伤普通文件夹。',
  },
  NO_WORKSPACE: {
    messageZh: '还没有选中工作区。',
    hintZh: '请先在左侧打开或创建一个工作区，再使用 Git。',
  },
  UNKNOWN_WORKSPACE: {
    messageZh: '找不到这个工作区。',
    hintZh: '工作区可能已被删除。请刷新页面，或重新选择一个本地目录。',
  },
  EMPTY_MESSAGE: {
    messageZh: '提交说明不能为空。',
    hintZh: '请用一两句话写清楚这次改了什么，然后再提交。',
  },
  NOTHING_STAGED: {
    messageZh: '没有已暂存的文件，无法提交。',
    hintZh: '请先勾选要提交的文件（暂存），确认右侧 diff 无误后再提交。',
  },
  INDEX_LOCKED: {
    messageZh: 'Git 正被其他进程占用（存在 index.lock）。',
    hintZh: '请等当前 Git 操作结束。若确认没有其他 Git 窗口，再检查仓库里的 `.git/index.lock`。',
  },
  DIRTY_WORKTREE: {
    messageZh: '工作区还有未提交的改动，不能切换分支。',
    hintZh: '请先提交或处理这些文件，再切换分支，以免改动丢失。',
  },
  BUSY: {
    messageZh: '上一次 Git 操作还在进行。',
    hintZh: '请稍等当前操作完成，不要连续点击。',
  },
  BRANCH_MISSING: {
    messageZh: '本地没有这个分支。',
    hintZh: '第一期只能切换已经存在的本地分支，不会自动创建或拉取远程分支。',
  },
  IDENTITY_MISSING: {
    messageZh: '还没有配置 Git 用户信息，无法提交。',
    hintZh: '请在终端执行：\ngit config --global user.name "你的名字"\ngit config --global user.email "you@example.com"',
  },
  INVALID_PATH: {
    messageZh: '文件路径不合法。',
    hintZh: '只能操作当前仓库内的相对路径，不能使用 .. 或仓库外的绝对路径。',
  },
  NETWORK: {
    messageZh: '无法连接 Git 服务。',
    hintZh: '请确认 DeepSeek Harness 网页仍在运行，然后点击重试。',
  },
  BAD_REQUEST: {
    messageZh: '请求参数不完整。',
    hintZh: '请刷新页面后重试。若仍然失败，请重新打开工作区。',
  },
  GIT_FAILED: {
    messageZh: 'Git 命令执行失败。',
    hintZh: '请查看详细原因。常见情况：合并进行中、钩子拒绝、或仓库状态异常。',
  },
  FS_NOT_FOUND: {
    messageZh: '找不到这个文件或文件夹。',
    hintZh: '它可能已被删除或移动。请在左侧目录里重新点开，或点刷新。',
  },
  FS_IS_DIRECTORY: {
    messageZh: '这是一个文件夹，不能当文件打开。',
    hintZh: '请在目录树里展开它，再点里面的文件。',
  },
  FS_TOO_LARGE: {
    messageZh: '文件超过 1.5 MB，编辑器不会打开。',
    hintZh: '太大的文件会把浏览器卡死。请用本机编辑器打开，或换一个更小的文件。',
  },
  FS_BINARY: {
    messageZh: '这是二进制文件，无法在文本编辑器中打开。',
    hintZh: '图片、压缩包、字体等请用本机应用打开。工作台只编辑文本文件。',
  },
  FS_WRITE_FAILED: {
    messageZh: '无法保存这个文件。',
    hintZh: '请确认文件不是只读、磁盘还有空间，然后重试。',
  },
}

/** Structured Git failure with Chinese copy the UI can show as-is. */
export class GitError extends Error {
  readonly code: GitErrorCode
  readonly messageZh: string
  readonly hintZh: string

  constructor(code: GitErrorCode, detail?: string) {
    const copy = COPY[code]
    const messageZh = detail && code === 'GIT_FAILED' ? `${copy.messageZh} ${detail}` : copy.messageZh
    super(`${code}: ${messageZh}`)
    this.name = 'GitError'
    this.code = code
    this.messageZh = messageZh
    this.hintZh = copy.hintZh
  }

  toFail(): GitFail {
    return { ok: false, code: this.code, messageZh: this.messageZh, hintZh: this.hintZh }
  }
}

export function fail(code: GitErrorCode, detail?: string): GitFail {
  return new GitError(code, detail).toFail()
}

export function toFail(error: unknown): GitFail {
  if (error instanceof GitError) return error.toFail()
  if (error instanceof Error && error.message.includes('index.lock')) return fail('INDEX_LOCKED')
  return fail('GIT_FAILED', error instanceof Error ? error.message : String(error))
}
