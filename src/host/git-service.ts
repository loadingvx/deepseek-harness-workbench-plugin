import { access } from 'node:fs/promises'
import { join, normalize, relative, resolve as resolvePath, sep } from 'node:path'
import { GitError } from '../shared/errors.ts'
import type {
  FileStatusKind, GitBranchInfo, GitCommitResult, GitDiffSnapshot, GitFileChange,
  GitLogEntry, GitProbe, GitPullResult, GitPushResult, GitRefMark, GitStatusSnapshot,
  GitSwitchResult,
} from '../shared/types.ts'
import { gitAvailable, runGit } from './git-exec.ts'
import { GitMutex } from './mutex.ts'

const KIND_LABEL: Record<FileStatusKind, string> = {
  modified: '已修改',
  added: '新增',
  deleted: '已删除',
  renamed: '已重命名',
  untracked: '未跟踪',
  conflict: '冲突',
}

function letterKind(letter: string): FileStatusKind {
  switch (letter) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R':
    case 'C': return 'renamed'
    case 'U': return 'conflict'
    case '?': return 'untracked'
    default: return 'modified'
  }
}

/** Parse `git log --format=%D` decorations into HEAD + typed ref marks. */
export function parseDecorations(raw: string): { head: boolean; refs: GitRefMark[] } {
  if (raw.trim() === '') return { head: false, refs: [] }
  let head = false
  const refs: GitRefMark[] = []
  for (const part of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    if (part === 'HEAD') {
      head = true
      continue
    }
    if (part.startsWith('HEAD -> ')) {
      head = true
      refs.push({ name: part.slice('HEAD -> '.length), kind: 'branch' })
      continue
    }
    if (part.startsWith('tag: ')) {
      refs.push({ name: part.slice('tag: '.length), kind: 'tag' })
      continue
    }
    refs.push({ name: part, kind: part.includes('/') ? 'remote' : 'branch' })
  }
  return { head, refs }
}

function parsePath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const arrow = trimmed.indexOf(' -> ')
  return arrow === -1 ? trimmed : trimmed.slice(arrow + 4)
}

export function assertSafeRepoPath(root: string, filePath: string): string {
  if (filePath.trim() === '') throw new GitError('INVALID_PATH')
  if (filePath.startsWith('-')) throw new GitError('INVALID_PATH')
  const resolved = resolvePath(root, filePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || rel === '' || normalize(rel).split(sep).includes('..')) {
    throw new GitError('INVALID_PATH')
  }
  return rel.split('\\').join('/')
}

function parseBranchLine(line: string): Pick<GitProbe, 'branch' | 'detached' | 'ahead' | 'behind' | 'upstream'> {
  // ## main...origin/main [ahead 1, behind 2]
  const rest = line.slice(3)
  if (rest.startsWith('HEAD (no branch)') || rest.startsWith('HEAD')) {
    const detachedMatch = /^HEAD(?: \(no branch\))?(?:\.\.\.(\S+))?/.exec(rest)
    return {
      branch: undefined,
      detached: true,
      ahead: 0,
      behind: 0,
      ...detachedMatch?.[1] ? { upstream: detachedMatch[1] } : {},
    }
  }
  const match = /^(\S+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(rest)
  let ahead = 0
  let behind = 0
  const tracking = match?.[3]
  if (tracking) {
    const aheadMatch = /ahead (\d+)/.exec(tracking)
    const behindMatch = /behind (\d+)/.exec(tracking)
    if (aheadMatch) ahead = Number(aheadMatch[1])
    if (behindMatch) behind = Number(behindMatch[1])
  }
  return {
    branch: match?.[1],
    detached: false,
    ahead,
    behind,
    ...match?.[2] ? { upstream: match[2] } : {},
  }
}

function parsePorcelain(stdout: string): { header: string; files: GitFileChange[] } {
  const lines = stdout.split(/\r?\n/).filter(line => line.length > 0)
  const header = lines.find(line => line.startsWith('## ')) ?? '## HEAD'
  const files: GitFileChange[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) continue
    if (line.startsWith('!! ')) continue
    if (line.startsWith('?')) {
      files.push({
        path: parsePath(line.slice(3)),
        kind: 'untracked',
        staged: false,
        labelZh: KIND_LABEL.untracked,
      })
      continue
    }
    if (line.length < 4) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const path = parsePath(line.slice(3))
    if (x !== ' ' && x !== '?') {
      const kind = letterKind(x)
      files.push({ path, kind, staged: true, labelZh: KIND_LABEL[kind] })
    }
    if (y !== ' ') {
      const kind = letterKind(y)
      files.push({ path, kind, staged: false, labelZh: KIND_LABEL[kind] })
    }
  }
  return { header, files }
}

/** Workspace-rooted Git operations with structured Chinese errors. */
export class GitService {
  private readonly mutex = new GitMutex()

  async probe(root: string, signal?: AbortSignal): Promise<GitProbe> {
    const available = await gitAvailable(signal)
    if (!available.ok) {
      return { gitAvailable: false, isRepo: false, detached: false, ahead: 0, behind: 0, hasHead: false }
    }
    try {
      const inside = await runGit({
        cwd: root, args: ['rev-parse', '--is-inside-work-tree'], signal, allowNonZero: true,
      })
      if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
        return { gitAvailable: true, gitVersion: available.version, isRepo: false, detached: false, ahead: 0, behind: 0, hasHead: false }
      }
      const top = await runGit({ cwd: root, args: ['rev-parse', '--show-toplevel'], signal })
      const status = await runGit({ cwd: root, args: ['status', '--porcelain=v1', '-b'], signal })
      const remotes = await runGit({ cwd: root, args: ['remote'], signal, allowNonZero: true })
      const head = await runGit({ cwd: root, args: ['rev-parse', '--verify', 'HEAD'], signal, allowNonZero: true })
      const { header } = parsePorcelain(status.stdout)
      const branch = parseBranchLine(header)
      const remote = remotes.stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean)
      return {
        gitAvailable: true,
        gitVersion: available.version,
        isRepo: true,
        root: top.stdout.trim(),
        detached: branch.detached,
        ahead: branch.ahead,
        behind: branch.behind,
        hasHead: head.exitCode === 0,
        ...branch.branch !== undefined ? { branch: branch.branch } : {},
        ...remote !== undefined ? { remote } : {},
        ...branch.upstream !== undefined ? { upstream: branch.upstream } : {},
      }
    } catch (error) {
      if (error instanceof GitError && error.code === 'NOT_A_REPO') {
        return { gitAvailable: true, gitVersion: available.version, isRepo: false, detached: false, ahead: 0, behind: 0, hasHead: false }
      }
      throw error
    }
  }

  async status(root: string, signal?: AbortSignal): Promise<GitStatusSnapshot> {
    const probe = await this.probe(root, signal)
    if (!probe.gitAvailable) throw new GitError('GIT_NOT_FOUND')
    if (!probe.isRepo) throw new GitError('NOT_A_REPO')
    const result = await runGit({ cwd: root, args: ['status', '--porcelain=v1', '-b'], signal })
    const { files } = parsePorcelain(result.stdout)
    return {
      probe,
      staged: files.filter(file => file.staged),
      unstaged: files.filter(file => !file.staged && file.kind !== 'untracked'),
      untracked: files.filter(file => file.kind === 'untracked'),
    }
  }

  async diff(root: string, path?: string, staged = false, signal?: AbortSignal): Promise<GitDiffSnapshot> {
    await this.requireRepo(root, signal)
    const args = ['diff', '--no-color', '--find-renames']
    if (staged) args.push('--cached')
    if (path !== undefined) {
      args.push('--', assertSafeRepoPath(root, path))
    }
    const result = await runGit({ cwd: root, args, signal, allowNonZero: true })
    const text = result.stdout
    return { staged, text, empty: text.trim() === '', ...path !== undefined ? { path } : {} }
  }

  async log(root: string, limit = 20, signal?: AbortSignal): Promise<GitLogEntry[]> {
    await this.requireRepo(root, signal)
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100)
    const result = await runGit({
      cwd: root,
      args: ['log', `-n${safeLimit}`, '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D', '--date=iso-strict'],
      signal,
      allowNonZero: true,
    })
    if (result.exitCode !== 0) return []
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, shortHash, author, date, subject, decorations] = line.split('\x1f')
      const marks = parseDecorations(decorations ?? '')
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
        head: marks.head,
        refs: marks.refs,
      }
    })
  }

  async branches(root: string, signal?: AbortSignal): Promise<GitBranchInfo[]> {
    await this.requireRepo(root, signal)
    const result = await runGit({ cwd: root, args: ['branch', '--list', '--format=%(refname:short)%09%(HEAD)'], signal })
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, head] = line.split('\t')
      return { name: name ?? '', current: head === '*' }
    }).filter(branch => branch.name !== '')
  }

  async stage(root: string, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    await this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      if (paths.length === 0) throw new GitError('INVALID_PATH')
      const safe = paths.map(path => assertSafeRepoPath(root, path))
      await runGit({ cwd: root, args: ['add', '--', ...safe], signal })
    })
  }

  async unstage(root: string, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    await this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      if (paths.length === 0) throw new GitError('INVALID_PATH')
      const safe = paths.map(path => assertSafeRepoPath(root, path))
      try {
        await runGit({ cwd: root, args: ['restore', '--staged', '--', ...safe], signal })
      } catch (error) {
        if (!(error instanceof GitError) || !/could not resolve 'HEAD'/i.test(error.message)) throw error
        await runGit({ cwd: root, args: ['rm', '--cached', '-q', '--', ...safe], signal })
      }
    })
  }

  async commit(root: string, message: string, all = false, signal?: AbortSignal): Promise<GitCommitResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const trimmed = message.trim()
      if (trimmed === '') throw new GitError('EMPTY_MESSAGE')
      const snapshot = await this.status(root, signal)
      if (snapshot.staged.length === 0) {
        const rest = [...snapshot.unstaged, ...snapshot.untracked].map(file => file.path)
        if (!all || rest.length === 0) throw new GitError('NOTHING_STAGED')
        await runGit({ cwd: root, args: ['add', '--', ...rest.map(path => assertSafeRepoPath(root, path))], signal })
      }
      await this.assertNoMergeLock(root)
      await runGit({ cwd: root, args: ['commit', '-m', trimmed], signal })
      const log = await this.log(root, 1, signal)
      const head = log[0]
      return { hash: head?.hash ?? '', subject: trimmed }
    })
  }

  async push(root: string, signal?: AbortSignal): Promise<GitPushResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const probe = await this.probe(root, signal)
      if (probe.detached) throw new GitError('DETACHED_HEAD')
      if (probe.remote === undefined) throw new GitError('NO_REMOTE')
      if (!probe.hasHead) throw new GitError('NOTHING_TO_PUSH')
      if (probe.behind > 0) throw new GitError('REMOTE_AHEAD')
      if (probe.ahead === 0 && probe.upstream !== undefined) throw new GitError('NOTHING_TO_PUSH')
      const branch = probe.branch
      if (branch === undefined || branch.trim() === '') throw new GitError('BRANCH_MISSING')
      if (probe.upstream !== undefined) {
        await runGit({ cwd: root, args: ['push'], signal, timeoutMs: 90_000 })
        return { remote: probe.remote, branch, setUpstream: false }
      }
      await runGit({ cwd: root, args: ['push', '-u', probe.remote, 'HEAD'], signal, timeoutMs: 90_000 })
      return { remote: probe.remote, branch, setUpstream: true }
    })
  }

  async pull(root: string, signal?: AbortSignal): Promise<GitPullResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const probe = await this.probe(root, signal)
      if (probe.detached) throw new GitError('DETACHED_HEAD')
      if (probe.remote === undefined) throw new GitError('NO_REMOTE')
      if (probe.upstream === undefined) throw new GitError('NO_UPSTREAM')
      const snapshot = await this.status(root, signal)
      const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
      if (dirty > 0) throw new GitError('DIRTY_WORKTREE')
      if (probe.behind === 0) throw new GitError('NOTHING_TO_PULL')
      const branch = probe.branch
      if (branch === undefined || branch.trim() === '') throw new GitError('BRANCH_MISSING')
      await runGit({ cwd: root, args: ['pull', '--ff-only'], signal, timeoutMs: 90_000 })
      return { remote: probe.remote, branch }
    })
  }

  async switchBranch(root: string, name: string, signal?: AbortSignal): Promise<GitSwitchResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const trimmed = name.trim()
      if (trimmed === '' || trimmed.startsWith('-')) throw new GitError('BRANCH_MISSING')
      const existing = await this.branches(root, signal)
      if (!existing.some(branch => branch.name === trimmed)) throw new GitError('BRANCH_MISSING')
      const snapshot = await this.status(root, signal)
      const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
      if (dirty > 0) throw new GitError('DIRTY_WORKTREE')
      await runGit({ cwd: root, args: ['switch', '--', trimmed], signal })
      return { branch: trimmed }
    })
  }

  private async requireRepo(root: string, signal?: AbortSignal): Promise<void> {
    const probe = await this.probe(root, signal)
    if (!probe.gitAvailable) throw new GitError('GIT_NOT_FOUND')
    if (!probe.isRepo) throw new GitError('NOT_A_REPO')
  }

  private async assertNoMergeLock(root: string): Promise<void> {
    try {
      await access(join(root, '.git', 'index.lock'))
      throw new GitError('INDEX_LOCKED')
    } catch (error) {
      if (error instanceof GitError) throw error
    }
    try {
      await access(join(root, '.git', 'MERGE_HEAD'))
      throw new GitError('GIT_FAILED', '仓库正在合并中，请先处理合并再提交。')
    } catch (error) {
      if (error instanceof GitError) throw error
    }
  }
}
