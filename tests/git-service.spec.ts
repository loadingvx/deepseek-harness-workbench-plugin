import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { runGit } from '../src/host/git-exec.ts'
import { assertSafeRepoPath, GitService } from '../src/host/git-service.ts'

const git = new GitService()
const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

async function initRepo(): Promise<string> {
  const root = await tempDir('dsh-workbench-')
  await runGit({ cwd: root, args: ['init', '-b', 'main'] })
  await runGit({ cwd: root, args: ['config', 'user.name', 'Test User'] })
  await runGit({ cwd: root, args: ['config', 'user.email', 'test@example.com'] })
  await runGit({ cwd: root, args: ['config', 'commit.gpgsign', 'false'] })
  return root
}

afterEach(async () => {
  // Leave temp dirs for the OS; tests never talk to a real remote.
  temps.length = 0
})

describe('assertSafeRepoPath', () => {
  it('rejects parent and absolute escapes', () => {
    expect(() => assertSafeRepoPath('/repo', '../secret')).toThrow(GitError)
    expect(() => assertSafeRepoPath('/repo', '/etc/passwd')).toThrow(GitError)
    expect(() => assertSafeRepoPath('/repo', '-evil')).toThrow(GitError)
  })

  it('accepts a normal relative file', () => {
    expect(assertSafeRepoPath('/repo', 'src/a.ts')).toBe('src/a.ts')
  })
})

describe('GitService', () => {
  it('reports a non-repo workspace without throwing', async () => {
    const dir = await tempDir('dsh-workbench-empty-')
    const probe = await git.probe(dir)
    expect(probe.gitAvailable).toBe(true)
    expect(probe.isRepo).toBe(false)
    await expect(git.status(dir)).rejects.toMatchObject({ code: 'NOT_A_REPO' })
  })

  it('stages, refuses empty commit, then commits', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'README.md'), 'hello\n')
    const dirty = await git.status(root)
    expect(dirty.untracked.map(file => file.path)).toContain('README.md')
    await expect(git.commit(root, 'should fail')).rejects.toMatchObject({ code: 'NOTHING_STAGED' })
    await git.stage(root, ['README.md'])
    await expect(git.commit(root, '   ')).rejects.toMatchObject({ code: 'EMPTY_MESSAGE' })
    const committed = await git.commit(root, 'add readme')
    expect(committed.subject).toBe('add readme')
    const clean = await git.status(root)
    expect(clean.staged).toHaveLength(0)
    expect(clean.unstaged).toHaveLength(0)
    expect(clean.untracked).toHaveLength(0)
    const log = await git.log(root, 5)
    expect(log[0]?.subject).toBe('add readme')
    expect(log[0]?.head).toBe(true)
    expect(log[0]?.refs.length).toBeGreaterThan(0)
  })

  it('commits all dirty files when nothing is staged', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'one.txt'), 'one\n')
    await git.stage(root, ['one.txt'])
    await git.commit(root, 'seed')
    await writeFile(join(root, 'one.txt'), 'one changed\n')
    await writeFile(join(root, 'two.txt'), 'two\n')
    await expect(git.commit(root, 'should fail')).rejects.toMatchObject({ code: 'NOTHING_STAGED' })
    const committed = await git.commit(root, 'chore: 一次提交全部', true)
    expect(committed.subject).toBe('chore: 一次提交全部')
    const clean = await git.status(root)
    expect(clean.staged).toHaveLength(0)
    expect(clean.unstaged).toHaveLength(0)
    expect(clean.untracked).toHaveLength(0)
  })

  it('unstages a staged file', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'a.txt'), 'a\n')
    await git.stage(root, ['a.txt'])
    expect((await git.status(root)).staged).toHaveLength(1)
    await git.unstage(root, ['a.txt'])
    const status = await git.status(root)
    expect(status.staged).toHaveLength(0)
    expect(status.untracked.map(file => file.path)).toContain('a.txt')
  })

  it('refuses a dirty branch switch and allows a clean one', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'a.txt'), 'a\n')
    await git.stage(root, ['a.txt'])
    await git.commit(root, 'first')
    await runGit({ cwd: root, args: ['branch', 'feature'] })
    await writeFile(join(root, 'a.txt'), 'changed\n')
    await expect(git.switchBranch(root, 'feature')).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' })
    await git.stage(root, ['a.txt'])
    await git.commit(root, 'keep dirty out')
    const switched = await git.switchBranch(root, 'feature')
    expect(switched.branch).toBe('feature')
    await expect(git.switchBranch(root, 'does-not-exist')).rejects.toMatchObject({ code: 'BRANCH_MISSING' })
  })

  it('serializes overlapping writes', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'a.txt'), 'a\n')
    await writeFile(join(root, 'b.txt'), 'b\n')
    const first = git.stage(root, ['a.txt'])
    const second = git.stage(root, ['b.txt'])
    const results = await Promise.allSettled([first, second])
    const rejected = results.filter(item => item.status === 'rejected')
    expect(rejected.length).toBe(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'BUSY' })
  })

  it('returns a usable diff after a tracked edit', async () => {
    const root = await initRepo()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src/app.ts'), ' cons t x = 1\n')
    await git.stage(root, ['src/app.ts'])
    await git.commit(root, 'seed')
    await writeFile(join(root, 'src/app.ts'), 'const x = 2\n')
    const diff = await git.diff(root, 'src/app.ts', false)
    expect(diff.empty).toBe(false)
    expect(diff.text).toContain('const x = 2')
  })

  it('pushes unpublished commits to a local remote, then refuses a no-op push', async () => {
    const remote = await tempDir('dsh-bare-')
    await runGit({ cwd: remote, args: ['init', '--bare', '-b', 'main'] })
    const root = await initRepo()
    await writeFile(join(root, 'a.txt'), 'a\n')
    await git.stage(root, ['a.txt'])
    await git.commit(root, 'first')
    await expect(git.push(root)).rejects.toMatchObject({ code: 'NO_REMOTE' })
    await runGit({ cwd: root, args: ['remote', 'add', 'origin', remote] })
    const first = await git.push(root)
    expect(first).toMatchObject({ remote: 'origin', branch: 'main', setUpstream: true })
    await expect(git.push(root)).rejects.toMatchObject({ code: 'NOTHING_TO_PUSH' })
    await writeFile(join(root, 'a.txt'), 'a2\n')
    await git.stage(root, ['a.txt'])
    await git.commit(root, 'second')
    expect((await git.status(root)).probe.ahead).toBe(1)
    const second = await git.push(root)
    expect(second.setUpstream).toBe(false)
    expect((await git.status(root)).probe.ahead).toBe(0)
  })

  it('pulls fast-forward updates and refuses when the worktree is dirty', async () => {
    const parent = await tempDir('dsh-pair-')
    const remote = join(parent, 'remote.git')
    const a = join(parent, 'a')
    await mkdir(remote)
    await mkdir(a)
    await runGit({ cwd: remote, args: ['init', '--bare', '-b', 'main'] })
    await runGit({ cwd: a, args: ['init', '-b', 'main'] })
    await runGit({ cwd: a, args: ['config', 'user.name', 'Test User'] })
    await runGit({ cwd: a, args: ['config', 'user.email', 'test@example.com'] })
    await runGit({ cwd: a, args: ['config', 'commit.gpgsign', 'false'] })
    await writeFile(join(a, 'a.txt'), 'one\n')
    await git.stage(a, ['a.txt'])
    await git.commit(a, 'seed')
    await runGit({ cwd: a, args: ['remote', 'add', 'origin', remote] })
    await git.push(a)
    await runGit({ cwd: parent, args: ['clone', remote, 'b'] })
    const b = join(parent, 'b')
    await runGit({ cwd: b, args: ['config', 'user.name', 'Test User'] })
    await runGit({ cwd: b, args: ['config', 'user.email', 'test@example.com'] })
    await runGit({ cwd: b, args: ['config', 'commit.gpgsign', 'false'] })
    await writeFile(join(a, 'a.txt'), 'two\n')
    await git.stage(a, ['a.txt'])
    await git.commit(a, 'ahead')
    await git.push(a)
    await runGit({ cwd: b, args: ['fetch'] })
    expect((await git.status(b)).probe.behind).toBe(1)
    const pulled = await git.pull(b)
    expect(pulled.remote).toBe('origin')
    expect((await git.status(b)).probe.behind).toBe(0)
    await writeFile(join(a, 'a.txt'), 'three\n')
    await git.stage(a, ['a.txt'])
    await git.commit(a, 'again')
    await git.push(a)
    await runGit({ cwd: b, args: ['fetch'] })
    await writeFile(join(b, 'dirty.txt'), 'nope\n')
    await expect(git.pull(b)).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' })
  })
})
