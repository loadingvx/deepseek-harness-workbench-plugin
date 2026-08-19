import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExternalOpen, detectWsl, whichOnPath, wslToWindowsPath } from '../src/host/external-open.ts'
import { WorkspaceFs } from '../src/host/workspace-fs.ts'
import { GitError } from '../src/shared/errors.ts'

const fs = new WorkspaceFs()

async function tempRoot(): Promise<string> {
  // Canonicalize: macOS tmpdir is often a symlink (/var → /private/var).
  return realpath(await mkdtemp(join(tmpdir(), 'dsh-open-')))
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
      isWsl: false,
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
      isWsl: false,
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
      isWsl: false,
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
      isWsl: false,
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
      isWsl: false,
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
      isWsl: false,
      which: async (bin) => bin === 'cursor' ? '/usr/bin/cursor' : undefined,
      launch: async (_bin, args) => { launched.push(String(args[0])) },
    })
    await opened.open(root, 'src', 'cursor')
    expect(launched[0]).toBe(join(root, 'src'))
  })

  it('reveals a file in Finder / Explorer / the Linux file manager', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'hi')
    const launched: Array<{ bin: string; args: string[] }> = []
    const darwin = new ExternalOpen(fs, {
      platform: 'darwin',
      which: async (bin) => bin === 'open' ? '/usr/bin/open' : undefined,
      launch: async (bin, args) => { launched.push({ bin, args: [...args] }) },
    })
    await darwin.reveal(root, 'note.txt')
    expect(launched[0]).toEqual({ bin: '/usr/bin/open', args: ['-R', join(root, 'note.txt')] })
    launched.length = 0
    const win = new ExternalOpen(fs, {
      platform: 'win32',
      which: async (bin) => bin === 'explorer.exe' ? 'C:\\Windows\\explorer.exe' : undefined,
      launch: async (bin, args) => { launched.push({ bin, args: [...args] }) },
    })
    await win.reveal(root, 'note.txt')
    expect(launched[0]?.args[0]).toBe(`/select,${join(root, 'note.txt')}`)
    launched.length = 0
    const linux = new ExternalOpen(fs, {
      platform: 'linux',
      isWsl: false,
      which: async (bin) => bin === 'xdg-open' ? '/usr/bin/xdg-open' : undefined,
      launch: async (bin, args) => { launched.push({ bin, args: [...args] }) },
    })
    await linux.reveal(root, 'note.txt')
    expect(launched[0]?.args[0]).toBe(root)
  })

  it('on WSL reveals via explorer.exe with a Windows path', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'hi')
    const launched: Array<{ bin: string; args: string[] }> = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      isWsl: true,
      toWindowsPath: async (abs) => `\\\\wsl.localhost\\Arch${abs.replace(/\//g, '\\')}`,
      which: async (bin) => bin === 'explorer.exe' ? '/mnt/c/Windows/explorer.exe' : undefined,
      launch: async (bin, args) => { launched.push({ bin, args: [...args] }) },
    })
    await opened.reveal(root, 'note.txt')
    expect(launched).toHaveLength(1)
    expect(launched[0]?.bin).toBe('/mnt/c/Windows/explorer.exe')
    expect(launched[0]?.args[0]).toBe(`/select,\\\\wsl.localhost\\Arch${join(root, 'note.txt').replace(/\//g, '\\')}`)
  })

  it('on WSL still succeeds when explorer.exe exits non-zero', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'hi')
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      isWsl: true,
      toWindowsPath: async (abs) => abs,
      which: async (bin) => bin === 'explorer.exe' ? '/mnt/c/Windows/explorer.exe' : undefined,
      launch: async () => { throw new GitError('EDITOR_FAILED') },
    })
    await expect(opened.reveal(root, 'note.txt')).resolves.toEqual({ path: 'note.txt' })
  })

  it('on WSL falls back to xdg-open when explorer.exe is missing', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'note.txt'), 'hi')
    const launched: string[] = []
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      isWsl: true,
      which: async (bin) => bin === 'xdg-open' ? '/usr/bin/xdg-open' : undefined,
      launch: async (bin) => { launched.push(bin) },
    })
    await opened.reveal(root, 'note.txt')
    expect(launched).toEqual(['/usr/bin/xdg-open'])
  })

  it('says the file manager is missing when no reveal binary exists', async () => {
    const root = await tempRoot()
    const opened = new ExternalOpen(fs, {
      platform: 'linux',
      isWsl: false,
      which: async () => undefined,
      launch: async () => { throw new Error('should not launch') },
    })
    await expect(opened.reveal(root, '')).rejects.toMatchObject({ code: 'FS_REVEAL_FAILED' })
  })
})

describe('detectWsl', () => {
  it('only treats Linux userland with WSL env as WSL', () => {
    expect(detectWsl('linux', { WSL_DISTRO_NAME: 'Arch' })).toBe(true)
    expect(detectWsl('linux', { WSL_INTEROP: '/run/WSL/1_interop' })).toBe(true)
    expect(detectWsl('linux', {})).toBe(false)
    expect(detectWsl('win32', { WSL_DISTRO_NAME: 'Arch' })).toBe(false)
    expect(detectWsl('darwin', { WSLENV: 'FOO' })).toBe(false)
  })
})

describe('wslToWindowsPath', () => {
  it('maps /mnt/c paths and WSL filesystem UNC paths', () => {
    expect(wslToWindowsPath('/mnt/c/Users/me/file.txt')).toBe('C:\\Users\\me\\file.txt')
    expect(wslToWindowsPath('/mnt/c')).toBe('C:\\')
    expect(wslToWindowsPath('/mnt/wsl/foo', 'Arch')).toBe('\\\\wsl.localhost\\Arch\\mnt\\wsl\\foo')
    expect(wslToWindowsPath('/root/proj', 'Arch')).toBe('\\\\wsl.localhost\\Arch\\root\\proj')
    expect(wslToWindowsPath('/root/proj')).toBeUndefined()
  })
})
