import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { assertSafeWorkspacePath, WorkspaceFs } from '../src/host/workspace-fs.ts'

const fs = new WorkspaceFs()

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-fs-'))
}

describe('assertSafeWorkspacePath', () => {
  it('allows the workspace root and nested files', () => {
    expect(assertSafeWorkspacePath('/repo', '')).toBe('')
    expect(assertSafeWorkspacePath('/repo', '.')).toBe('')
    expect(assertSafeWorkspacePath('/repo', 'src/a.ts')).toBe('src/a.ts')
  })

  it('rejects escapes', () => {
    expect(() => assertSafeWorkspacePath('/repo', '../secret')).toThrow(GitError)
    expect(() => assertSafeWorkspacePath('/repo', '/etc/passwd')).toThrow(GitError)
  })
})

describe('WorkspaceFs', () => {
  it('lists directories with folders first', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'README.md'), 'hi\n')
    await writeFile(join(root, '.hidden'), 'x')
    const listed = await fs.list(root, '')
    expect(listed.entries.map(item => item.name)).toEqual(['src', '.hidden', 'README.md'])
    expect(listed.entries[0]?.kind).toBe('directory')
    expect(listed.entries.find(item => item.name === '.hidden')?.hidden).toBe(true)
  })

  it('reads and writes a text file', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'old')
    const before = await fs.read(root, 'note.txt')
    expect(before.content).toBe('old')
    const written = await fs.write(root, 'note.txt', '新内容\n')
    expect(written.size).toBeGreaterThan(0)
    const after = await fs.read(root, 'note.txt')
    expect(after.content).toBe('新内容\n')
  })

  it('refuses binary, missing, and directory reads', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
    await expect(fs.read(root, 'missing.txt')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(fs.read(root, 'src')).rejects.toMatchObject({ code: 'FS_IS_DIRECTORY' })
    await expect(fs.read(root, 'blob.bin')).rejects.toMatchObject({ code: 'FS_BINARY' })
  })

  it('does not follow a symlink out of the workspace', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(outside, 'secret.txt'), 'leak')
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    await expect(fs.read(root, 'link.txt')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
})
