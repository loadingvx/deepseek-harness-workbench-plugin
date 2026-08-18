import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { CURRENT_REPO_ID, PARENT_REPO_ID } from '../src/shared/git-nearby.ts'
import { hasGitRoot, parseGitmodulePaths, resolveNearbyGitPath, scanNearbyGit } from '../src/host/git-nearby.ts'

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

async function markGit(dir: string): Promise<void> {
  await mkdir(join(dir, '.git'))
}

afterEach(() => {
  temps.length = 0
})

describe('hasGitRoot', () => {
  it('is true only when this folder itself has .git', async () => {
    const parent = await tempDir('dsh-nearby-parent-')
    await markGit(parent)
    const child = join(parent, 'app')
    await mkdir(child)
    expect(await hasGitRoot(parent)).toBe(true)
    expect(await hasGitRoot(child)).toBe(false)
  })
})

describe('scanNearbyGit', () => {
  it('finds the parent git root and one-level child repos, skipping node_modules', async () => {
    const parent = await tempDir('dsh-nearby-scan-')
    await markGit(parent)
    const workspace = join(parent, 'app')
    await mkdir(workspace)
    await markGit(workspace)
    const nested = join(workspace, 'packages')
    await mkdir(nested)
    await markGit(nested)
    const modules = join(workspace, 'node_modules', 'left-pad')
    await mkdir(modules, { recursive: true })
    await markGit(modules)
    await mkdir(join(workspace, 'docs'))

    const snap = await scanNearbyGit(workspace)
    expect(snap.current.isRepo).toBe(true)
    expect(snap.parent?.id).toBe(PARENT_REPO_ID)
    expect(snap.children.map(item => item.id)).toEqual(['packages'])
  })

  it('does not treat a nested folder of a parent repo as the current repo', async () => {
    const parent = await tempDir('dsh-nearby-inside-')
    await markGit(parent)
    const workspace = join(parent, 'pkg')
    await mkdir(workspace)
    await writeFile(join(workspace, 'readme.txt'), 'hi\n')
    const snap = await scanNearbyGit(workspace)
    expect(snap.current.isRepo).toBe(false)
    expect(snap.parent?.isRepo).toBe(true)
  })

  it('follows a first-level symlink that points at an outside git repo', async () => {
    const outside = await tempDir('dsh-nearby-link-target-')
    await markGit(outside)
    const workspace = await tempDir('dsh-nearby-link-ws-')
    await markGit(workspace)
    await symlink(outside, join(workspace, 'deepseek-harness'))
    const snap = await scanNearbyGit(workspace)
    expect(snap.children).toEqual([
      { id: 'deepseek-harness', kind: 'link', name: 'deepseek-harness', isRepo: true },
    ])
    expect(await resolveNearbyGitPath(workspace, 'deepseek-harness')).toBe(await realpath(outside))
  })

  it('includes initialized nested submodules from .gitmodules', async () => {
    const workspace = await tempDir('dsh-nearby-sub-')
    await markGit(workspace)
    const nested = join(workspace, 'third_party', 'sdk')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, '.git'), 'gitdir: ../../.git/modules/sdk\n')
    await writeFile(join(workspace, '.gitmodules'), [
      '[submodule "sdk"]',
      '\tpath = third_party/sdk',
      '\turl = https://example.com/sdk.git',
      '',
    ].join('\n'))
    const snap = await scanNearbyGit(workspace)
    expect(snap.children).toEqual([
      { id: 'third_party/sdk', kind: 'submodule', name: 'third_party/sdk', isRepo: true },
    ])
    expect(await resolveNearbyGitPath(workspace, 'third_party/sdk')).toBe(await realpath(nested))
  })
})

describe('parseGitmodulePaths', () => {
  it('reads path entries and ignores comments', () => {
    expect(parseGitmodulePaths([
      '[submodule "sdk"]',
      '\tpath = third_party/sdk',
      '# path = ignored',
      '\turl = https://example.com/sdk.git',
      '[submodule "quoted"]',
      '\tpath = "vendor/lib"',
    ].join('\n'))).toEqual(['third_party/sdk', 'vendor/lib'])
  })
})

describe('resolveNearbyGitPath', () => {
  it('resolves current, parent, and child, and rejects escapes', async () => {
    const parent = await tempDir('dsh-nearby-resolve-')
    await markGit(parent)
    const workspace = join(parent, 'app')
    await mkdir(workspace)
    await markGit(workspace)
    const nested = join(workspace, 'cli')
    await mkdir(nested)
    await markGit(nested)

    expect(await resolveNearbyGitPath(workspace, CURRENT_REPO_ID)).toBe(await realpath(workspace))
    expect(await resolveNearbyGitPath(workspace, PARENT_REPO_ID)).toBe(await realpath(parent))
    expect(await resolveNearbyGitPath(workspace, 'cli')).toBe(await realpath(nested))
    await expect(resolveNearbyGitPath(workspace, '../secret')).rejects.toMatchObject({ code: 'UNKNOWN_REPO' })
    await expect(resolveNearbyGitPath(workspace, 'missing')).rejects.toBeInstanceOf(GitError)
  })
})
