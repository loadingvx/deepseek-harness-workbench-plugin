import { mkdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { runGit } from '../src/host/git-exec.ts'
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

  it('searches by file name and skips node_modules unless asked', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'src', 'FileTree.tsx'), 'x')
    await writeFile(join(root, 'README.md'), 'x')
    await writeFile(join(root, 'node_modules', 'pkg', 'FileTree.tsx'), 'nope')
    const found = await fs.search(root, 'filetree')
    expect(found.hits.map(item => item.path)).toEqual(['src/FileTree.tsx'])
    const byExt = await fs.search(root, '.md')
    expect(byExt.hits.map(item => item.path)).toEqual(['README.md'])
    const hidden = await fs.search(root, '.env')
    expect(hidden.hits).toEqual([])
    await writeFile(join(root, '.env'), 'x')
    const env = await fs.search(root, '.env')
    expect(env.hits.map(item => item.path)).toEqual(['.env'])
  })

  it('resolves a file or the root to an absolute path inside the workspace', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'x')
    const realRoot = await realpath(root)
    expect(await fs.resolveAbsolute(root, '')).toBe(realRoot)
    expect(await fs.resolveAbsolute(root, 'note.txt')).toBe(join(realRoot, 'note.txt'))
    await expect(fs.resolveAbsolute(root, '../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('does not follow a symlink out of the workspace', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(outside, 'secret.txt'), 'leak')
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    await expect(fs.read(root, 'link.txt')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('reads real images with their MIME type and rejects fakes', async () => {
    const root = await tempRoot()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    await writeFile(join(root, 'shot.png'), png)
    const image = await fs.readImage(root, 'shot.png')
    expect(image.mime).toBe('image/png')
    expect(image.buffer.equals(png)).toBe(true)

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
    await writeFile(join(root, 'photo.jpg'), jpeg)
    expect((await fs.readImage(root, 'photo.jpg')).mime).toBe('image/jpeg')

    await writeFile(join(root, 'fake.png'), 'not an image at all')
    await expect(fs.readImage(root, 'fake.png')).rejects.toMatchObject({ code: 'FS_BINARY' })

    await writeFile(join(root, 'notes.txt'), 'text')
    await expect(fs.readImage(root, 'notes.txt')).rejects.toMatchObject({ code: 'FS_BINARY' })

    await expect(fs.readImage(root, 'missing.png')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })
})

describe('WorkspaceFs rename / move / delete', () => {
  it('renames a file in place', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'old.txt'), 'x')
    const result = await fs.rename(root, 'old.txt', 'new.txt')
    expect(result.path).toBe('new.txt')
    await expect(fs.read(root, 'new.txt')).resolves.toMatchObject({ content: 'x' })
    await expect(fs.read(root, 'old.txt')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })

  it('moves a file into a subfolder', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'a.txt'), 'a')
    await fs.rename(root, 'a.txt', 'src/a.txt')
    await expect(fs.read(root, 'src/a.txt')).resolves.toMatchObject({ content: 'a' })
    await expect(fs.read(root, 'a.txt')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })

  it('renames a folder and moves a file into it', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'old'))
    await writeFile(join(root, 'old/inner.txt'), 'i')
    await fs.rename(root, 'old', 'renamed')
    await expect(fs.read(root, 'renamed/inner.txt')).resolves.toMatchObject({ content: 'i' })
    await writeFile(join(root, 'loose.txt'), 'l')
    await fs.rename(root, 'loose.txt', 'renamed/loose.txt')
    await expect(fs.read(root, 'renamed/loose.txt')).resolves.toMatchObject({ content: 'l' })
  })

  it('rejects renaming onto an existing entry', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'a.txt'), 'a')
    await writeFile(join(root, 'b.txt'), 'b')
    await expect(fs.rename(root, 'a.txt', 'b.txt')).rejects.toMatchObject({ code: 'FS_EXISTS' })
    await expect(fs.rename(root, 'a.txt', 'a.txt')).rejects.toMatchObject({ code: 'FS_EXISTS' })
  })

  it('rejects moving a folder into itself or its descendant', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'dir', 'sub'), { recursive: true })
    await expect(fs.rename(root, 'dir', 'dir')).rejects.toThrow(GitError)
    await expect(fs.rename(root, 'dir', 'dir/sub')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(fs.rename(root, '', 'dir')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('deletes a file and a folder recursively', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'keep.txt'), 'keep')
    await mkdir(join(root, 'folder', 'nested'), { recursive: true })
    await writeFile(join(root, 'folder', 'nested', 'deep.txt'), 'd')
    await writeFile(join(root, 'folder', 'top.txt'), 't')
    const deleted = await fs.delete(root, 'folder')
    expect(deleted.path).toBe('folder')
    await expect(stat(join(root, 'folder'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.read(root, 'keep.txt')).resolves.toMatchObject({ content: 'keep' })
    await expect(fs.delete(root, 'missing.txt')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(fs.delete(root, '')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('marks gitignored paths so the explorer can dim them', async () => {
    const root = await tempRoot()
    await runGit({ cwd: root, args: ['init', '-b', 'main'] })
    await runGit({ cwd: root, args: ['config', 'user.name', 'Test User'] })
    await runGit({ cwd: root, args: ['config', 'user.email', 'test@example.com'] })
    await runGit({ cwd: root, args: ['config', 'commit.gpgsign', 'false'] })
    await writeFile(join(root, '.gitignore'), 'dist\n*.log\n')
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'keep.ts'), 'x\n')
    await writeFile(join(root, 'noise.log'), 'x\n')
    await writeFile(join(root, 'dist', 'out.js'), 'x\n')
    const listed = await fs.list(root, '')
    expect(listed.entries.find(item => item.name === 'keep.ts')?.ignored).toBe(false)
    expect(listed.entries.find(item => item.name === 'noise.log')?.ignored).toBe(true)
    expect(listed.entries.find(item => item.name === 'dist')?.ignored).toBe(true)
    expect(listed.entries.find(item => item.name === '.gitignore')?.ignored).toBe(false)
    const readLog = await fs.read(root, 'noise.log')
    expect(readLog.ignored).toBe(true)
    const readKeep = await fs.read(root, 'keep.ts')
    expect(readKeep.ignored).toBe(false)
    await runGit({ cwd: root, args: ['add', 'keep.ts', '.gitignore'] })
    await runGit({ cwd: root, args: ['commit', '-m', 'seed'] })
    await writeFile(join(root, '.gitignore'), 'dist\n*.log\nkeep.ts\n')
    const after = await fs.list(root, '')
    expect(after.entries.find(item => item.name === 'keep.ts')?.ignored).toBe(false)
  })
})
