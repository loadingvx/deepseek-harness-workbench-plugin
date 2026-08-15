import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExternalOpen, whichOnPath } from '../src/host/external-open.ts'
import { WorkspaceFs } from '../src/host/workspace-fs.ts'
import { GitError } from '../src/shared/errors.ts'

const fs = new WorkspaceFs()

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-open-'))
}

describe('whichOnPath', () => {
  it('rejects path-like names so a command string cannot sneak in', async () => {
    expect(await whichOnPath('/usr/bin/cursor')).toBeUndefined()
    expect(await whichOnPath('../code')).toBeUndefined()
    expect(await whichOnPath('code;reboot')).toBeUndefined()
    expect(await whichOnPath('')).toBeUndefined()
  })
})

describe('ExternalOpen', () => {
  it('lists allowlisted apps and marks what is on PATH', async () => {
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async (bin) => bin === 'cursor' || bin === 'xdg-open' ? `/bin/${bin}` : undefined,
    })
    const listed = await opened.list()
    expect(listed.editors.map(item => item.id)).toEqual([
      'cursor', 'vscode', 'vscode-insiders', 'codium', 'windsurf', 'zed', 'system',
    ])
    expect(listed.editors.find(item => item.id === 'cursor')?.available).toBe(true)
    expect(listed.editors.find(item => item.id === 'vscode')?.available).toBe(false)
    expect(listed.editors.find(item => item.id === 'system')?.available).toBe(true)
  })

  it('opens a workspace file with the chosen catalog binary only', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'hi')
    const launched: { bin: string; args: readonly string[] }[] = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async (bin) => bin === 'code' ? '/usr/bin/code' : undefined,
      launch: async (bin, args) => { launched.push({ bin, args }) },
    })
    const result = await opened.open(root, 'note.txt', 'vscode')
    expect(result.app).toBe('vscode')
    expect(result.path).toBe('note.txt')
    expect(launched).toEqual([{ bin: '/usr/bin/code', args: [join(root, 'note.txt')] }])
  })

  it('opens the workspace root when the path is empty', async () => {
    const root = await tempRoot()
    const launched: readonly string[][] = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async (bin) => bin === 'cursor' ? '/usr/bin/cursor' : undefined,
      launch: async (_bin, args) => { launched.push([...args]) },
    })
    await opened.open(root, '', 'cursor')
    expect(launched[0]?.[0]).toBe(root)
  })

  it('picks the first available editor when none is specified', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'a.ts'), '')
    const launched: string[] = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async (bin) => bin === 'code' ? '/usr/bin/code' : undefined,
      launch: async (bin) => { launched.push(bin) },
    })
    const result = await opened.open(root, 'a.ts')
    expect(result.app).toBe('vscode')
    expect(launched).toEqual(['/usr/bin/code'])
  })

  it('rejects an unknown app id and never launches', async () => {
    const root = await tempRoot()
    let launched = 0
    const opened = new ExternalOpen(fs, {
      which: async () => '/usr/bin/cursor',
      launch: async () => { launched += 1 },
    })
    await expect(opened.open(root, '', 'notepad')).rejects.toMatchObject({ code: 'EDITOR_UNKNOWN' })
    await expect(opened.open(root, '', 'cursor; rm -rf /')).rejects.toMatchObject({ code: 'EDITOR_UNKNOWN' })
    expect(launched).toBe(0)
  })

  it('rejects a path that escapes the workspace', async () => {
    const root = await tempRoot()
    let launched = 0
    const opened = new ExternalOpen(fs, {
      which: async () => '/usr/bin/cursor',
      launch: async () => { launched += 1 },
    })
    await expect(opened.open(root, '../secret', 'cursor')).rejects.toBeInstanceOf(GitError)
    await expect(opened.open(root, '../secret', 'cursor')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(launched).toBe(0)
  })

  it('says the editor is missing when the catalog binary is not on PATH', async () => {
    const root = await tempRoot()
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async () => undefined,
      launch: async () => { throw new Error('should not launch') },
    })
    await expect(opened.open(root, '', 'cursor')).rejects.toMatchObject({ code: 'EDITOR_NOT_FOUND' })
    await expect(opened.open(root, '')).rejects.toMatchObject({ code: 'EDITOR_NOT_FOUND' })
  })

  it('can open a folder inside the workspace', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'src'))
    const launched: string[] = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      which: async (bin) => bin === 'cursor' ? '/usr/bin/cursor' : undefined,
      launch: async (_bin, args) => { launched.push(String(args[0])) },
    })
    await opened.open(root, 'src', 'cursor')
    expect(launched[0]).toBe(join(root, 'src'))
  })
})
