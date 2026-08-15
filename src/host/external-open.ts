import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { EXTERNAL_EDITOR_IDS, isExternalEditorId, type ExternalEditorId, type ExternalEditorsSnapshot, type ExternalOpenResult } from '../shared/types.ts'
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

export interface ExternalOpenDeps {
  which?(bin: string): Promise<string | undefined>
  launch?(bin: string, args: readonly string[]): Promise<void>
  platform?: NodeJS.Platform
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

/** Detect allowlisted local editors and open a workspace-jailed path in one of them. */
export class ExternalOpen {
  constructor(
    private readonly fs: WorkspaceFs,
    private readonly deps: ExternalOpenDeps = {},
  ) {}

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
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
