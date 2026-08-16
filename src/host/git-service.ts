import { access, stat } from 'node:fs/promises'
import { join, normalize, relative, resolve as resolvePath, sep } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { invalidBranchName, normalizeBranchName } from '../shared/branch-name.ts'
import { MAX_FILE_BYTES } from './workspace-fs.ts'
import type {
  FileStatusKind, GitBranchInfo, GitCommitResult, GitCreateBranchResult, GitDiffSnapshot,
  GitFetchResult, GitFileChange, GitLogEntry, GitMergeResult, GitProbe, GitPullResult,
  GitPushResult, GitRefMark, GitStatusSnapshot, GitSwitchResult,
} from '../shared/types.ts'
import { parsePullMode, parsePushMode, pullArgs, pushArgs, type PullMode, type PushMode } from '../shared/git-sync-prefs.ts'
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
    // origin/HEAD is a symbolic remote tip, not a real branch to draw.
    if (part.includes('/') && part.endsWith('/HEAD')) continue
    refs.push({ name: part, kind: part.includes('/') ? 'remote' : 'branch' })
  }
  return { head, refs }
}

/** Parse `git log --format=%P` parent hashes. */
export function parseParents(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const seen = new Set<string>()
  const parents: string[] = []
  for (const part of raw.trim().split(/\s+/)) {
    if (!/^[0-9a-f]{7,64}$/i.test(part) || seen.has(part)) continue
    seen.add(part)
    parents.push(part)
  }
  return parents
}

function parsePath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const arrow = trimmed.indexOf(' -> ')
  return arrow === -1 ? trimmed : trimmed.slice(arrow + 4)
}

/** Visible header so an empty new file is not mistaken for “no diff”. */
export function emptyNewFileDiff(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
  ].join('\n') + '\n'
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
    const safePath = path !== undefined ? assertSafeRepoPath(root, path) : undefined
    if (safePath !== undefined && !staged) {
      const untracked = await this.diffUntrackedFile(root, safePath, signal)
      if (untracked !== undefined) {
        return { staged, path: safePath, text: untracked, empty: untracked.trim() === '' }
      }
    }
    const args = ['diff', '--no-color', '--find-renames']
    if (staged) args.push('--cached')
    if (safePath !== undefined) args.push('--', safePath)
    const result = await runGit({ cwd: root, args, signal, allowNonZero: true })
    const text = result.stdout
    return { staged, text, empty: text.trim() === '', ...safePath !== undefined ? { path: safePath } : {} }
  }

  async log(root: string, limit = 80, signal?: AbortSignal): Promise<GitLogEntry[]> {
    await this.requireRepo(root, signal)
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100)
    const result = await runGit({
      cwd: root,
      args: [
        'log',
        `--max-count=${safeLimit}`,
        '--decorate=short',
        '--topo-order',
        '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1f%P',
        '--date=iso-strict',
        'HEAD',
        '--branches',
        '--remotes',
        '--tags',
      ],
      signal,
      allowNonZero: true,
    })
    if (result.exitCode !== 0) return []
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, shortHash, author, date, subject, decorations, parentRaw] = line.split('\x1f')
      const marks = parseDecorations(decorations ?? '')
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
        head: marks.head,
        refs: marks.refs,
        parents: parseParents(parentRaw),
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

  /** Discard worktree edits (`git restore`) or delete untracked paths (`git clean -f`). */
  async restore(root: string, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    await this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      if (paths.length === 0) throw new GitError('INVALID_PATH')
      const safe = paths.map(path => assertSafeRepoPath(root, path))
      const snapshot = await this.status(root, signal)
      const untracked = new Set(snapshot.untracked.map(file => file.path))
      const tracked = safe.filter(path => !untracked.has(path))
      const junk = safe.filter(path => untracked.has(path))
      if (tracked.length > 0) {
        await runGit({ cwd: root, args: ['restore', '--worktree', '--', ...tracked], signal })
      }
      if (junk.length === 0) return
      const files: string[] = []
      const dirs: string[] = []
      for (const path of junk) {
        try {
          const info = await stat(join(root, path))
          if (info.isDirectory()) dirs.push(path)
          else files.push(path)
        } catch {
          files.push(path)
        }
      }
      if (files.length > 0) {
        await runGit({ cwd: root, args: ['clean', '-f', '--', ...files], signal })
      }
      if (dirs.length > 0) {
        await runGit({ cwd: root, args: ['clean', '-fd', '--', ...dirs], signal })
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
      const head = await runGit({ cwd: root, args: ['rev-parse', 'HEAD'], signal })
      return { hash: head.stdout.trim(), subject: trimmed }
    })
  }

  /** Update remote-tracking refs, then re-read ahead/behind. Caller must already hold the mutex. */
  private async refreshTracking(root: string, probe: GitProbe, signal?: AbortSignal): Promise<GitProbe> {
    if (probe.remote === undefined) return probe
    await runGit({ cwd: root, args: ['fetch', '--prune', probe.remote], signal, timeoutMs: 90_000 })
    return this.probe(root, signal)
  }

  private async abortInterruptedPull(root: string, mode: PullMode, signal?: AbortSignal): Promise<void> {
    const args = mode === 'rebase' ? ['rebase', '--abort'] : ['merge', '--abort']
    await runGit({ cwd: root, args, signal, allowNonZero: true, timeoutMs: 15_000 })
  }

  async push(root: string, signal?: AbortSignal, pushMode: PushMode = 'safe'): Promise<GitPushResult> {
    const mode = parsePushMode(pushMode)
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      let probe = await this.probe(root, signal)
      if (probe.detached) throw new GitError('DETACHED_HEAD')
      if (probe.remote === undefined) throw new GitError('NO_REMOTE')
      if (!probe.hasHead) throw new GitError('NOTHING_TO_PUSH')
      probe = await this.refreshTracking(root, probe, signal)
      if (probe.behind > 0 && mode !== 'lease') throw new GitError('REMOTE_AHEAD')
      if (probe.ahead === 0 && probe.upstream !== undefined) throw new GitError('NOTHING_TO_PUSH')
      const branch = probe.branch
      if (branch === undefined || branch.trim() === '') throw new GitError('BRANCH_MISSING')
      const setUpstream = probe.upstream === undefined
      await runGit({ cwd: root, args: pushArgs(mode, probe.remote, setUpstream), signal, timeoutMs: 90_000 })
      return { remote: probe.remote, branch, setUpstream }
    })
  }

  async pull(root: string, signal?: AbortSignal, pullMode: PullMode = 'merge'): Promise<GitPullResult> {
    const mode = parsePullMode(pullMode)
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      let probe = await this.probe(root, signal)
      if (probe.detached) throw new GitError('DETACHED_HEAD')
      if (probe.remote === undefined) throw new GitError('NO_REMOTE')
      if (probe.upstream === undefined) throw new GitError('NO_UPSTREAM')
      const snapshot = await this.status(root, signal)
      const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
      if (dirty > 0) throw new GitError('DIRTY_WORKTREE')
      probe = await this.refreshTracking(root, probe, signal)
      if (probe.behind === 0) throw new GitError('NOTHING_TO_PULL')
      const branch = probe.branch
      if (branch === undefined || branch.trim() === '') throw new GitError('BRANCH_MISSING')
      try {
        await runGit({ cwd: root, args: pullArgs(mode), signal, timeoutMs: 90_000 })
      } catch (error) {
        await this.abortInterruptedPull(root, mode, signal)
        throw error
      }
      return { remote: probe.remote, branch }
    })
  }

  async switchBranch(root: string, name: string, signal?: AbortSignal): Promise<GitSwitchResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const trimmed = this.requireExistingBranch(name, await this.branches(root, signal))
      const snapshot = await this.status(root, signal)
      const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
      if (dirty > 0) throw new GitError('DIRTY_WORKTREE')
      await runGit({ cwd: root, args: ['switch', '--', trimmed], signal })
      return { branch: trimmed }
    })
  }

  async fetch(root: string, signal?: AbortSignal): Promise<GitFetchResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const probe = await this.probe(root, signal)
      if (probe.remote === undefined) throw new GitError('NO_REMOTE')
      await runGit({ cwd: root, args: ['fetch', '--prune', probe.remote], signal, timeoutMs: 90_000 })
      return { remote: probe.remote }
    })
  }

  async createBranch(root: string, name: string, signal?: AbortSignal): Promise<GitCreateBranchResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const trimmed = this.requireNewBranchName(name)
      const existing = await this.branches(root, signal)
      if (existing.some(branch => branch.name === trimmed)) throw new GitError('BRANCH_EXISTS')
      await runGit({ cwd: root, args: ['switch', '-c', trimmed], signal })
      return { branch: trimmed }
    })
  }

  async mergeBranch(root: string, name: string, signal?: AbortSignal): Promise<GitMergeResult> {
    return this.mutex.run(async () => {
      await this.requireRepo(root, signal)
      const probe = await this.probe(root, signal)
      if (probe.detached) throw new GitError('DETACHED_HEAD')
      const current = probe.branch
      if (current === undefined || current.trim() === '') throw new GitError('BRANCH_MISSING')
      const trimmed = this.requireExistingBranch(name, await this.branches(root, signal))
      if (trimmed === current) throw new GitError('GIT_FAILED', '不能把当前分支合并到自己。')
      const snapshot = await this.status(root, signal)
      const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
      if (dirty > 0) throw new GitError('DIRTY_WORKTREE')
      await this.assertNoMergeLock(root)
      try {
        await runGit({ cwd: root, args: ['merge', '--no-edit', '--', trimmed], signal })
      } catch (error) {
        const conflict = await this.hasMergeHead(root)
        await runGit({ cwd: root, args: ['merge', '--abort'], signal, allowNonZero: true })
        if (conflict || (error instanceof GitError && error.code === 'MERGE_CONFLICT')) {
          throw new GitError('MERGE_CONFLICT')
        }
        throw error
      }
      return { branch: current, from: trimmed }
    })
  }

  /** Untracked files are invisible to `git diff`; show them as a full addition. */
  private async diffUntrackedFile(root: string, safePath: string, signal?: AbortSignal): Promise<string | undefined> {
    let info
    try {
      info = await stat(join(root, safePath))
    } catch {
      return undefined
    }
    if (info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')
    if (info.size > MAX_FILE_BYTES) throw new GitError('FS_TOO_LARGE')
    const listed = await runGit({
      cwd: root,
      args: ['ls-files', '--error-unmatch', '--', safePath],
      signal,
      allowNonZero: true,
    })
    if (listed.exitCode === 0) return undefined
    const result = await runGit({
      cwd: root,
      args: ['diff', '--no-color', '--no-index', '--', '/dev/null', safePath],
      signal,
      allowNonZero: true,
    })
    if (result.exitCode > 1 && result.stdout.trim() === '') {
      throw new GitError('GIT_FAILED', result.stderr.trim() || `无法读取未跟踪文件 ${safePath}`)
    }
    if (result.stdout.trim() !== '') return result.stdout
    return emptyNewFileDiff(safePath)
  }

  private requireNewBranchName(name: string): string {
    const reason = invalidBranchName(name)
    if (reason !== null) throw new GitError('BRANCH_INVALID')
    return normalizeBranchName(name)
  }

  private requireExistingBranch(name: string, existing: GitBranchInfo[]): string {
    const reason = invalidBranchName(name)
    if (reason !== null) throw new GitError(reason === 'empty' ? 'BRANCH_MISSING' : 'BRANCH_INVALID')
    const trimmed = normalizeBranchName(name)
    if (!existing.some(branch => branch.name === trimmed)) throw new GitError('BRANCH_MISSING')
    return trimmed
  }


  /** Files touched by a commit, with their change kind (A/M/D/R/…). Works for the root commit too. */
  async commitFiles(root: string, hash: string, signal?: AbortSignal): Promise<GitFileChange[]> {
    await this.requireRepo(root, signal)
    const safeHash = await this.requireCommitHash(hash, root, signal)
    const result = await runGit({
      cwd: root,
      args: ['diff-tree', '--no-commit-id', '--root', '--name-status', '-r', safeHash],
      signal,
      allowNonZero: true,
    })
    if (result.exitCode !== 0) throw new GitError('GIT_FAILED', result.stderr.trim() || '无法读取提交 ' + hash + ' 的改动文件')
    const files: GitFileChange[] = []
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.trim() === '') continue
      const parts = line.split('\t')
      const letter = (parts[0] ?? '').trim()
      if (letter === '') continue
      // R100\told\tnew → path is the new name; plain entries are XY\tpath.
      const path = parts.length >= 3 ? (parts[2] ?? '') : (parts[1] ?? '')
      if (path.trim() === '') continue
      const kind = letterKind(letter.charAt(0) ?? 'M')
      files.push({ path: path.trim(), kind, staged: false, labelZh: KIND_LABEL[kind] })
    }
    return files
  }

  /** Unified diff of a single file inside a commit. */
  async commitDiff(root: string, hash: string, path: string, signal?: AbortSignal): Promise<GitDiffSnapshot> {
    await this.requireRepo(root, signal)
    const safeHash = await this.requireCommitHash(hash, root, signal)
    const safePath = assertSafeRepoPath(root, path)
    const result = await runGit({
      cwd: root,
      args: ['show', '--no-color', '--format=', safeHash, '--', safePath],
      signal,
      allowNonZero: true,
    })
    if (result.exitCode !== 0) throw new GitError('GIT_FAILED', result.stderr.trim() || '无法读取提交 ' + hash + ' 中 ' + path + ' 的差异')
    return { staged: false, path: safePath, text: result.stdout, empty: result.stdout.trim() === '' }
  }

  private async requireCommitHash(hash: string, root: string, signal?: AbortSignal): Promise<string> {
    const trimmed = hash.trim()
    if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) throw new GitError('INVALID_PATH')
    const verified = await runGit({
      cwd: root,
      args: ['rev-parse', '--verify', '--quiet', trimmed + '^{commit}'],
      signal,
      allowNonZero: true,
    })
    if (verified.exitCode !== 0 || verified.stdout.trim() === '') {
      throw new GitError('GIT_FAILED', '找不到这个提交。')
    }
    return verified.stdout.trim()
  }

  private async requireRepo(root: string, signal?: AbortSignal): Promise<void> {
    const probe = await this.probe(root, signal)
    if (!probe.gitAvailable) throw new GitError('GIT_NOT_FOUND')
    if (!probe.isRepo) throw new GitError('NOT_A_REPO')
  }

  private async hasMergeHead(root: string): Promise<boolean> {
    try {
      await access(join(root, '.git', 'MERGE_HEAD'))
      return true
    } catch {
      return false
    }
  }

  private async assertNoMergeLock(root: string): Promise<void> {
    try {
      await access(join(root, '.git', 'index.lock'))
      throw new GitError('INDEX_LOCKED')
    } catch (error) {
      if (error instanceof GitError) throw error
    }
    if (await this.hasMergeHead(root)) {
      throw new GitError('GIT_FAILED', '仓库正在合并中，请先处理合并再提交。')
    }
  }
}
