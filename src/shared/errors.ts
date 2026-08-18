import { redactSecrets } from './redact.ts'
import type { GitErrorCode, GitFail } from './types.ts'

const COPY: Record<GitErrorCode, { messageZh: string; hintZh: string }> = {
  GIT_NOT_FOUND: {
    messageZh: '本机没有可用的 git 命令。',
    hintZh: '请先安装 Git，并确认终端里执行 `git --version` 能成功。Debian/Ubuntu 可用 `sudo apt install git`。',
  },
  NOT_A_REPO: {
    messageZh: '当前工作区还不是 Git 仓库。',
    hintZh: '请在右侧「源代码管理」里初始化仓库，或打开一个已经是仓库的文件夹。不会自动执行 git init。',
  },
  NO_WORKSPACE: {
    messageZh: '还没有选中工作区。',
    hintZh: '请先在左侧打开或创建一个工作区，再使用 Git。',
  },
  UNKNOWN_WORKSPACE: {
    messageZh: '找不到这个工作区。',
    hintZh: '工作区可能已被删除。请刷新页面，或重新选择一个本地目录。',
  },
  UNKNOWN_REPO: {
    messageZh: '找不到这个 Git 仓库。',
    hintZh: '只能选当前目录、已纳入的上一级，或当前目录下的仓库、软链和子模块。请从列表里重新选。',
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
    messageZh: '工作区还有未提交的改动。',
    hintZh: '请先提交或处理这些文件，再切换分支、拉取或推送，以免改动丢失。',
  },
  BUSY: {
    messageZh: '上一次 Git 操作还在进行。',
    hintZh: '请稍等当前操作完成，不要连续点击。',
  },
  BRANCH_MISSING: {
    messageZh: '本地没有这个分支。',
    hintZh: '请从列表里选一个已经存在的本地分支。要新建，请用 GRAPH 栏的「新建分支」。',
  },
  BRANCH_EXISTS: {
    messageZh: '这个分支名已经有了。',
    hintZh: '请换一个名字，或先切到已有分支再继续。',
  },
  BRANCH_INVALID: {
    messageZh: '分支名不合法。',
    hintZh: '不要用空格、..、~ ^ : ? * [ \\，也不要以 - / . 开头或以 / . 结尾。最长 64 个字符。',
  },
  MERGE_CONFLICT: {
    messageZh: '合并时出现冲突，已自动取消，工作区保持原样。',
    hintZh: '两边改了同一处。请在终端里手动处理，或先和同事对齐后再拉取。本插件不会留下半成品合并。',
  },
  IDENTITY_MISSING: {
    messageZh: '还没有配置 Git 用户信息，无法提交。',
    hintZh: '请填写姓名和邮箱。新仓库可以在初始化时填写；已有仓库可在终端执行：\ngit config --global user.name "你的名字"\ngit config --global user.email "you@example.com"',
  },
  IDENTITY_INVALID: {
    messageZh: '姓名或邮箱格式不正确。',
    hintZh: '姓名不能为空，也不能包含换行。邮箱必须包含 @，例如 you@company.com。',
  },
  INVALID_PATH: {
    messageZh: '文件路径不合法。',
    hintZh: '只能操作当前仓库内的相对路径，不能使用 .. 或仓库外的绝对路径。',
  },
  NETWORK: {
    messageZh: '无法连接工作台服务。',
    hintZh: '请确认 DeepSeek Harness 网页仍在运行，然后点击右上角刷新。',
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
  FS_EXISTS: {
    messageZh: '这个名字已经有人用了。',
    hintZh: '换一个名字，或先把同名文件处理掉再试。',
  },
  FS_RENAME_FAILED: {
    messageZh: '无法重命名或移动这个文件。',
    hintZh: '请确认目标位置可以写入、源文件没有被占用，然后重试。',
  },
  FS_DELETE_FAILED: {
    messageZh: '无法删除这个文件。',
    hintZh: '请确认文件没有被占用，或没有权限限制，然后重试。',
  },
  FS_MKDIR_FAILED: {
    messageZh: '无法创建这个文件夹。',
    hintZh: '请确认上层目录可以写入、磁盘还有空间，然后重试。',
  },
  FS_COPY_FAILED: {
    messageZh: '无法复制这个文件。',
    hintZh: '请确认目标位置可以写入、源文件还在，然后重试。',
  },
  FS_REVEAL_FAILED: {
    messageZh: '没法打开系统文件管理器。',
    hintZh: '若在 Windows 或 WSL，请确认资源管理器能打开，并且终端里执行 explorer.exe 能启动。若在 Linux 桌面，请确认已安装文件管理器，且终端能执行 xdg-open。没有图形界面的远程或容器环境无法使用此功能。',
  },
  LLM_UNAVAILABLE: {
    messageZh: '现在没法调用模型。',
    hintZh: '请确认会话里已经配好可用模型。这次调用不会写入当前对话。也可以先自己动手完成。',
  },
  LLM_FAILED: {
    messageZh: '模型调用失败。',
    hintZh: '请稍后重试。常见原因：模型未就绪、网络中断、思考占用了输出、或内容太长。',
  },
  NOTHING_TO_DESCRIBE: {
    messageZh: '没有可描述的改动。',
    hintZh: '请先修改或暂存文件，再点自动生成。工作区是干净的时候无法生成提交说明。',
  },
  NO_REMOTE: {
    messageZh: '这个仓库还没有配置远程地址。',
    hintZh: '请先添加远程，例如：git remote add origin <仓库地址>。没有远程时不能推送或拉取。',
  },
  NO_UPSTREAM: {
    messageZh: '当前分支还没有对应的远端分支。',
    hintZh: '第一次推送会自动设置跟踪。若要拉取，请先推送一次，或确认远程已有同名分支。',
  },
  NOTHING_TO_PUSH: {
    messageZh: '没有需要推送的新提交。',
    hintZh: '本地已经和远端同步，或还没有任何提交。提交之后才会出现推送按钮。',
  },
  NOTHING_TO_PULL: {
    messageZh: '远端没有可拉取的新提交。',
    hintZh: '当前分支没有落后远端。只有远端有更新时才会出现拉取按钮。',
  },
  REMOTE_AHEAD: {
    messageZh: '远端有新提交，不能直接推送。',
    hintZh: '请先点「拉取」，把远端更新接到本地，确认没有冲突后再推送。',
  },
  DIVERGED: {
    messageZh: '本地和远端都有对方没有的提交，当前拉取方式无法接入。',
    hintZh: '请在齿轮设置里把拉取改为「合并」（git pull --no-rebase），或在终端处理分叉后再试。',
  },
  AUTH_FAILED: {
    messageZh: '远程仓库拒绝了身份验证。',
    hintZh: '请检查 SSH 密钥或 HTTPS 凭据是否有效。本插件不会弹出密码框，需要本机已经配置好认证。',
  },
  REMOTE_UNREACHABLE: {
    messageZh: '连不上远程仓库。',
    hintZh: '请检查网络、远程地址，以及本机能否访问该 Git 服务，然后重试。',
  },
  DETACHED_HEAD: {
    messageZh: '当前处于分离 HEAD，不能推送或拉取。',
    hintZh: '请先切换到一个普通分支，再同步远端。',
  },
  EDITOR_NOT_FOUND: {
    messageZh: '本机没有找到可用的外部编辑器。',
    hintZh: '请先安装 Cursor 或 VS Code，并确认终端里能执行 `cursor` 或 `code`。装好后点右上角三角重新选择。',
  },
  EDITOR_FAILED: {
    messageZh: '外部编辑器没有打开成功。',
    hintZh: '请确认这个软件还能启动。也可以点三角换一个本机应用再试。',
  },
  EDITOR_UNKNOWN: {
    messageZh: '不支持用这个应用打开。',
    hintZh: '请从列表里选 Cursor、VS Code 或系统默认应用。不会执行列表以外的命令。',
  },
  TERM_NO_SHELL: {
    messageZh: '本机没有可用的命令行程序。',
    hintZh: '请确认系统里有 bash 或 zsh，并且终端里能执行 `bash`。',
  },
  TERM_FAILED: {
    messageZh: '工作区命令行没有启动成功。',
    hintZh: '请确认已经打开本地工作区，然后点「重新连接」。若反复失败，请确认本机有 bash/zsh，并且 DeepSeek Harness 能创建伪终端。',
  },
}

/** Structured Git failure with Chinese copy the UI can show as-is. */
export class GitError extends Error {
  readonly code: GitErrorCode
  readonly messageZh: string
  readonly hintZh: string

  constructor(code: GitErrorCode, detail?: string) {
    const copy = COPY[code]
    const safe = detail === undefined ? undefined : redactSecrets(detail)
    const messageZh = safe && (code === 'GIT_FAILED' || code === 'LLM_FAILED' || code === 'TERM_FAILED')
      ? `${copy.messageZh} ${safe}`
      : copy.messageZh
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
  if (error instanceof Error && /without inject|llm/i.test(error.message)) return fail('LLM_UNAVAILABLE')
  return fail('GIT_FAILED', error instanceof Error ? error.message : String(error))
}