import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { GitError, toFail } from '../shared/errors.ts'
import type { GitService } from './git-service.ts'
import { resolveWorkspacePath } from './workspace.ts'

function cwdOf(ctx: Context, exec: ToolRunContext): string {
  return resolveWorkspacePath(ctx, undefined, exec.agent?.session?.header?.cwd)
}

function text(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function failPayload(error: unknown): Record<string, unknown> {
  const fail = toFail(error)
  return { ok: false, code: fail.code, message: fail.messageZh, hint: fail.hintZh }
}

/** Register model-facing git_* tools and require approval for commit. */
export function registerGitTools(ctx: Context, git: GitService): () => void {
  const disposeStatus = ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Show git status of the current workspace: branch, ahead/behind, staged, unstaged, and untracked files.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => text(value),
    },
    async execute(_args, exec) {
      try {
        return { ok: true, ...(await git.status(cwdOf(ctx, exec), exec.signal)) }
      } catch (error) {
        return failPayload(error)
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Git 状态', kind: 'search' }),
  }))

  const disposeDiff = ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Show a git diff. Optional path limits the file; staged=true uses the index.',
    parameters: {
      path: { type: 'string', description: 'Repository-relative file path' },
      staged: { type: 'boolean', description: 'If true, show staged diff' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      try {
        const path = typeof args.path === 'string' ? args.path : undefined
        const staged = args.staged === true
        return { ok: true, ...(await git.diff(cwdOf(ctx, exec), path, staged, exec.signal)) }
      } catch (error) {
        return failPayload(error)
      }
    },
    presentCall: (args) => ({
      card: 'diff',
      title: args.path ? `Git diff ${args.path}` : 'Git diff',
      diffs: [{ path: typeof args.path === 'string' ? args.path : '.', oldText: '', newText: '' }],
    }),
  }))

  const disposeLog = ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'Show recent git commits in the current workspace.',
    parameters: {
      limit: { type: 'number', description: 'Number of commits, default 20, max 100' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      try {
        const limit = typeof args.limit === 'number' ? args.limit : 20
        return { ok: true, entries: await git.log(cwdOf(ctx, exec), limit, exec.signal) }
      } catch (error) {
        return failPayload(error)
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Git 提交历史' }),
  }))

  const disposeBranch = ctx.tools.register(defineTool({
    name: 'git_branch',
    description: 'List local branches, or switch to an existing local branch. Switching is refused when the worktree is dirty. Does not create branches or touch remotes.',
    parameters: {
      action: { type: 'string', required: true, description: 'list or switch', enum: ['list', 'switch'] },
      name: { type: 'string', description: 'Existing local branch name when action is switch' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      try {
        const root = cwdOf(ctx, exec)
        if (args.action === 'switch') {
          if (typeof args.name !== 'string' || args.name.trim() === '') {
            throw new GitError('BRANCH_MISSING')
          }
          return { ok: true, ...(await git.switchBranch(root, args.name, exec.signal)) }
        }
        return { ok: true, branches: await git.branches(root, exec.signal) }
      } catch (error) {
        return failPayload(error)
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.action === 'switch' ? `切换分支 ${args.name ?? ''}` : 'Git 分支',
    }),
  }))

  const disposeCommit = ctx.tools.register(defineTool({
    name: 'git_commit',
    description: 'Create a git commit from already-staged files. Requires a non-empty message. Does not stage files, push, or amend. The user must approve this call.',
    parameters: {
      message: { type: 'string', required: true, description: 'Commit message' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      try {
        if (typeof args.message !== 'string') throw new GitError('EMPTY_MESSAGE')
        return { ok: true, ...(await git.commit(cwdOf(ctx, exec), args.message, exec.signal)) }
      } catch (error) {
        return failPayload(error)
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Git 提交',
      content: typeof args.message === 'string' ? args.message : '',
    }),
  }))

  const offAsk = ctx.on('tools/pre-execute', async (exec, next) => {
    const call = exec as ToolRunContext
    if (call.name !== 'git_commit') return (next as () => unknown)()
    return { kind: 'ask', reason: '提交会写入 Git 历史。请确认提交说明和已暂存文件后再允许。' }
  })

  return () => {
    disposeStatus()
    disposeDiff()
    disposeLog()
    disposeBranch()
    disposeCommit()
    offAsk()
  }
}
