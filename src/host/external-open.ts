import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { EXTERNAL_EDITOR_IDS, isExternalEditorId, type ExternalEditorId, type ExternalEditorsSnapshot, type ExternalOpenResult, type FsRevealResult } from '../shared/types.ts'
import type { WorkspaceFs } from './workspace-fs.ts'

interface EditorSpec {
  id: ExternalEditorId
  label: string
  bins: Partial<Record<NodeJS.Platform, readonly string[]>>
}

const CATALOG: readonly EditorSpec[] = [
  { id: 'cursor', label: 'Cursor', bins: { linux: ['cursor'], darwin: ['cursor'], win32: ['cursor.cmd', 'cursor'] } },
  { id: 'vscode', label: 'VS Code', bins: { linux: ['code'], darwin: ['code'], win32: ['code.cmd', 'code'] } },
  { id: 'vscode-insiders', label: 'VS Code Insiders', bins: { linux: ['code-insiders'], darwin: ['code-insiders'], win32: ['code-insiders.cmd', 'code-insiders'] } },
  { id: 'codium', label: 'VSCodium', bins: { linux: ['codium'], darwin: ['codium'], win32: ['codium.cmd', 'codium'] } },
  { id: 'windsurf', label: 'Windsurf', bins: { linux: ['windsurf'], darwin: ['windsurf'], win32: ['windsurf.cmd', 'windsurf'] } },
  { id: 'zed', label: 'Zed', bins: { linux: ['zed', 'zeditor'], darwin: ['zed'], win32: ['zed.exe', 'zed'] } },
  { id: 'system', label: 'System', bins: { linux: ['xdg-open'], darwin: ['open'], win32: ['explorer.exe'] } },
]

const SETTLE_MS = 600

const WSL_EXPLORER_PATHS = ['/mnt/c/Windows/explorer.exe', '/mnt/c/WINDOWS/explorer.exe'] as const

export interface ExternalOpenDeps {
  which?(bin: string): Promise<string | undefined>
  launch?(bin: string, args: readonly string[]): Promise<void>
  platform?: NodeJS.Platform
  /** Override WSL detection. Default reads WSL_DISTRO_NAME / WSL_INTEROP / WSLENV. */
  isWsl?: boolean
  toWindowsPath?(linuxPath: string): Promise<string>
}

/** WSL userland only. Do not use the kernel osrelease — containers on WSL share it. */
export function detectWsl(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform !== 'linux') return false
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV)
}

/** Best-effort WSL → Windows path when `wslpath` is missing. */
export function wslToWindowsPath(abs: string, distro = ''): string | undefined {
  const driveRest = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(abs)
  if (driveRest?.[1] !== undefined) {
    const rest = (driveRest[2] ?? '').replace(/\//g, '\\')
    return rest === '' ? `${driveRest[1].toUpperCase()}:\\` : `${driveRest[1].toUpperCase()}:\\${rest}`
  }
  const driveOnly = /^\/mnt\/([a-zA-Z])\/?$/.exec(abs)
  if (driveOnly?.[1] !== undefined) return `${driveOnly[1].toUpperCase()}:\\`
  if (distro === '') return undefined
  const unix = abs.startsWith('/') ? abs : `/${abs}`
  return `\\\\wsl.localhost\\${distro}${unix.replace(/\//g, '\\')}`
}

function binsFor(spec: EditorSpec, platform: NodeJS.Platform): readonly string[] {
  return spec.bins[platform] ?? spec.bins.linux ?? []
}

function looksLikeBareName(bin: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(bin)
}

/** Resolve a catalog binary on PATH. Never accepts a user-supplied command string. */
export async function whichOnPath(bin: string, envPath = process.env.PATH ?? ''): Promise<string | undefined> {
  if (!looksLikeBareName(bin)) return undefined
  const dirs = envPath.split(delimiter).filter(dir => dir !== '')
  const win = process.platform === 'win32'
  const names = win && !bin.includes('.') ? [bin, `${bin}.cmd`, `${bin}.exe`] : [bin]
  const mode = win ? constants.F_OK : constants.X_OK
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name)
      try {
        await access(full, mode)
        return full
      } catch {
        // try next candidate
      }
    }
  }
  return undefined
}

function launchDetached(bin: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
    let settled = false
    const finish = (error?: GitError): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      child.unref()
      resolve()
    }
    const timer = setTimeout(() => { finish() }, SETTLE_MS)
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT' ? new GitError('EDITOR_NOT_FOUND') : new GitError('EDITOR_FAILED'))
    })
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        finish()
        return
      }
      finish(new GitError('EDITOR_FAILED'))
    })
  })
}

function captureOutput(bin: string, args: readonly string[], timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('timeout'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `exit ${code ?? 1}`))
    })
  })
}

async function defaultWslWindowsPath(abs: string): Promise<string> {
  try {
    const converted = await captureOutput('wslpath', ['-w', abs])
    if (converted !== '') return converted
  } catch {
    // fall through to UNC / /mnt/c mapping
  }
  const fallback = wslToWindowsPath(abs, process.env.WSL_DISTRO_NAME ?? '')
  if (fallback === undefined) throw new GitError('FS_REVEAL_FAILED')
  return fallback
}

/** Detect allowlisted local editors and open a workspace-jailed path in one of them. */
export class ExternalOpen {
  constructor(
    private readonly fs: WorkspaceFs,
    private readonly deps: ExternalOpenDeps = {},
  ) {}

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
  }

  private isWsl(): boolean {
    if (this.deps.isWsl !== undefined) return this.deps.isWsl
    return detectWsl(this.platform())
  }

  private async windowsPath(abs: string): Promise<string> {
    if (this.deps.toWindowsPath !== undefined) return this.deps.toWindowsPath(abs)
    return defaultWslWindowsPath(abs)
  }

  private async resolveExplorer(lookup: (bin: string) => Promise<string | undefined>): Promise<string | undefined> {
    const fromPath = await lookup('explorer.exe') ?? await lookup('explorer')
    if (fromPath !== undefined) return fromPath
    if (this.deps.which !== undefined) return undefined
    for (const full of WSL_EXPLORER_PATHS) {
      try {
        await access(full, constants.X_OK)
        return full
      } catch {
        // try next well-known location
      }
    }
    return undefined
  }

  private async runReveal(
    launch: (bin: string, args: readonly string[]) => Promise<void>,
    bin: string,
    args: readonly string[],
    ignoreNonZero: boolean,
  ): Promise<void> {
    try {
      await launch(bin, args)
    } catch (error) {
      if (ignoreNonZero && error instanceof GitError && error.code === 'EDITOR_FAILED') return
      throw new GitError('FS_REVEAL_FAILED')
    }
  }

  private async resolveBin(spec: EditorSpec): Promise<string | undefined> {
    const lookup = this.deps.which ?? whichOnPath
    for (const bin of binsFor(spec, this.platform())) {
      const found = await lookup(bin)
      if (found !== undefined) return found
    }
    return undefined
  }

  async list(): Promise<ExternalEditorsSnapshot> {
    const editors = []
    for (const spec of CATALOG) {
      editors.push({
        id: spec.id,
        label: spec.label,
        available: (await this.resolveBin(spec)) !== undefined,
      })
    }
    return { editors }
  }

  async open(root: string, filePath = '', app?: string): Promise<ExternalOpenResult> {
    const spec = await this.pickSpec(app)
    const bin = await this.resolveBin(spec)
    if (bin === undefined) throw new GitError('EDITOR_NOT_FOUND')
    const abs = await this.fs.resolveAbsolute(root, filePath)
    const launch = this.deps.launch ?? launchDetached
    await launch(bin, [abs])
    return { app: spec.id, path: filePath.trim() === '.' ? '' : filePath.trim() }
  }

  /** Open the system file manager at this workspace path (Finder / Explorer / Files). WSL uses Windows Explorer. */
  async reveal(root: string, filePath = ''): Promise<FsRevealResult> {
    const abs = await this.fs.resolveAbsolute(root, filePath)
    const lookup = this.deps.which ?? whichOnPath
    const launch = this.deps.launch ?? launchDetached
    const platform = this.platform()
    const rel = filePath.trim() === '.' ? '' : filePath.trim()
    const wsl = platform === 'linux' && this.isWsl()
    if (platform === 'darwin') {
      const bin = await lookup('open')
      if (bin === undefined) throw new GitError('FS_REVEAL_FAILED')
      await this.runReveal(launch, bin, ['-R', abs], false)
      return { path: rel }
    }
    if (platform === 'win32' || wsl) {
      const explorer = await this.resolveExplorer(lookup)
      if (explorer !== undefined) {
        const target = wsl ? await this.windowsPath(abs) : abs
        await this.runReveal(launch, explorer, [`/select,${target}`], true)
        return { path: rel }
      }
      if (!wsl) throw new GitError('FS_REVEAL_FAILED')
    }
    const bin = await lookup('xdg-open')
    if (bin === undefined) throw new GitError('FS_REVEAL_FAILED')
    let target = abs
    try {
      const info = await stat(abs)
      if (!info.isDirectory()) target = dirname(abs)
    } catch {
      target = dirname(abs)
    }
    await this.runReveal(launch, bin, [target], false)
    return { path: rel }
  }

  private async pickSpec(app?: string): Promise<EditorSpec> {
    if (app !== undefined && app !== '') {
      if (!isExternalEditorId(app)) throw new GitError('EDITOR_UNKNOWN')
      const chosen = CATALOG.find(item => item.id === app)
      if (chosen === undefined) throw new GitError('EDITOR_UNKNOWN')
      return chosen
    }
    for (const id of EXTERNAL_EDITOR_IDS) {
      const spec = CATALOG.find(item => item.id === id)
      if (spec === undefined) continue
      if ((await this.resolveBin(spec)) !== undefined) return spec
    }
    throw new GitError('EDITOR_NOT_FOUND')
  }
}
