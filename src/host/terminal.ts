import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { termSessionKey } from '../shared/new-file-path.ts'
import { redactSecrets } from '../shared/redact.ts'

const MAX_BUFFER = 200_000
const MAX_WRITE = 256_000
const ALLOWED_SHELL = /^(bash|zsh|sh|dash)$/
const ALLOWED_ABS = /^\/(bin|usr\/bin|usr\/local\/bin)\/(bash|zsh|sh|dash)$/
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

export interface TerminalHello {
  cwd: string
  shell: string
  cols: number
  rows: number
}

export type TerminalEvent =
  | { type: 'hello'; cwd: string; shell: string; cols: number; rows: number }
  | { type: 'out'; text: string }
  | { type: 'exit'; code: number | null }

export interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(handler: (data: string) => void): { dispose(): void }
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export interface TerminalDeps {
  spawnPty?: (bin: string, cwd: string, cols: number, rows: number, env: NodeJS.ProcessEnv) => Promise<PtyHandle>
  exists?: (abs: string) => Promise<boolean>
  env?: NodeJS.ProcessEnv
}

function looksLikeAllowedShell(path: string): boolean {
  const trimmed = path.trim()
  if (ALLOWED_ABS.test(trimmed)) return true
  return !trimmed.includes('/') && !trimmed.includes('\\') && ALLOWED_SHELL.test(trimmed)
}

export async function pickShell(env: NodeJS.ProcessEnv = process.env, exists?: (abs: string) => Promise<boolean>): Promise<string> {
  const check = exists ?? (async (abs: string) => {
    try {
      await access(abs, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
  const preferred = env.SHELL !== undefined && looksLikeAllowedShell(env.SHELL) ? [env.SHELL] : []
  const candidates = [...preferred, '/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh', '/usr/bin/sh']
  const seen = new Set<string>()
  for (const item of candidates) {
    if (seen.has(item)) continue
    seen.add(item)
    if (!looksLikeAllowedShell(item)) continue
    const abs = item.startsWith('/') ? item : undefined
    if (abs === undefined) continue
    if (await check(abs)) return abs
  }
  throw new GitError('TERM_NO_SHELL')
}

export function clampSize(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function termColorEnv(base: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv {
  return {
    ...base,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    PWD: cwd,
  }
}

interface Session {
  cwd: string
  shell: string
  pty: PtyHandle
  buffer: string
  cols: number
  rows: number
  listeners: Set<(event: TerminalEvent) => void>
}

function appendBuffer(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next
}

function writeSse(res: ServerResponse, event: TerminalEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function loadNodePty(): Promise<{ spawn: (file: string, args: string[], options: Record<string, unknown>) => {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(handler: (data: string) => void): { dispose(): void }
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
} }> {
  try {
    return await import('node-pty')
  } catch {
    const candidates = [
      join(homedir(), '.dsh/profiles/node_modules/node-pty'),
      join(process.cwd(), 'node_modules/node-pty'),
    ]
    for (const dir of candidates) {
      try {
        return createRequire(join(dir, 'package.json'))(dir) as Awaited<ReturnType<typeof loadNodePty>>
      } catch { /* try next */ }
    }
    throw new GitError('TERM_FAILED')
  }
}

async function defaultSpawnPty(bin: string, cwd: string, cols: number, rows: number, env: NodeJS.ProcessEnv): Promise<PtyHandle> {
  const pty = await loadNodePty()
  return pty.spawn(bin, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: termColorEnv(env, cwd),
  })
}

/** One real PTY per workspace terminal tab. Output is redacted before it reaches the browser. */
export class TerminalHub {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: TerminalDeps = {}) {}

  private key(workspaceId: string, termId?: string): string {
    return termSessionKey(workspaceId, termId)
  }

  async attach(workspaceId: string, cwd: string, res: ServerResponse, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId?: string): Promise<void> {
    const session = await this.ensure(workspaceId, cwd, cols, rows, termId)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    writeSse(res, {
      type: 'hello',
      cwd: session.cwd,
      shell: basename(session.shell),
      cols: session.cols,
      rows: session.rows,
    })
    if (session.buffer !== '') writeSse(res, { type: 'out', text: session.buffer })
    const send = (event: TerminalEvent): void => { writeSse(res, event) }
    session.listeners.add(send)
    const ping = setInterval(() => { res.write(': ping\n\n') }, 15_000)
    const drop = (): void => {
      clearInterval(ping)
      session.listeners.delete(send)
    }
    res.on('close', drop)
    res.on('error', drop)
  }

  async write(workspaceId: string, cwd: string, data: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId?: string): Promise<{ ok: true }> {
    if (data.length > MAX_WRITE) throw new GitError('BAD_REQUEST')
    const session = await this.ensure(workspaceId, cwd, cols, rows, termId)
    session.pty.write(data)
    return { ok: true }
  }

  async resize(workspaceId: string, cwd: string, cols: number, rows: number, termId?: string): Promise<{ ok: true; cols: number; rows: number }> {
    const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS)
    const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS)
    const session = await this.ensure(workspaceId, cwd, nextCols, nextRows, termId)
    session.cols = nextCols
    session.rows = nextRows
    session.pty.resize(nextCols, nextRows)
    return { ok: true, cols: nextCols, rows: nextRows }
  }

  async interrupt(workspaceId: string, cwd: string, termId?: string): Promise<{ ok: true }> {
    const session = await this.ensure(workspaceId, cwd, DEFAULT_COLS, DEFAULT_ROWS, termId)
    session.pty.write('\x03')
    return { ok: true }
  }

  async close(workspaceId: string, termId?: string): Promise<{ ok: true }> {
    this.kill(this.key(workspaceId, termId))
    return { ok: true }
  }

  async restart(workspaceId: string, cwd: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, termId?: string): Promise<TerminalHello> {
    const key = this.key(workspaceId, termId)
    const existing = this.sessions.get(key)
    const listeners = existing === undefined ? new Set<(event: TerminalEvent) => void>() : new Set(existing.listeners)
    if (existing !== undefined) {
      existing.listeners.clear()
      this.sessions.delete(key)
      try { existing.pty.kill() } catch { /* already gone */ }
    }
    const session = await this.ensure(workspaceId, cwd, cols, rows, termId)
    for (const listener of listeners) session.listeners.add(listener)
    return { cwd: session.cwd, shell: basename(session.shell), cols: session.cols, rows: session.rows }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private kill(key: string): void {
    const session = this.sessions.get(key)
    if (session === undefined) return
    this.sessions.delete(key)
    try { session.pty.kill() } catch { /* already gone */ }
    for (const listener of session.listeners) listener({ type: 'exit', code: null })
    session.listeners.clear()
  }

  private emit(session: Session, event: TerminalEvent): void {
    if (event.type === 'out') {
      const text = redactSecrets(event.text)
      session.buffer = appendBuffer(session.buffer, text)
      const safe = { ...event, text }
      for (const listener of session.listeners) listener(safe)
      return
    }
    for (const listener of session.listeners) listener(event)
  }

  private async ensure(workspaceId: string, cwd: string, cols: number, rows: number, termId?: string): Promise<Session> {
    const key = this.key(workspaceId, termId)
    const existing = this.sessions.get(key)
    if (existing !== undefined && existing.cwd === cwd) return existing
    if (existing !== undefined) this.kill(key)
    const shell = await pickShell(this.deps.env ?? process.env, this.deps.exists)
    const spawnPty = this.deps.spawnPty ?? defaultSpawnPty
    const nextCols = clampSize(cols, 10, 400, DEFAULT_COLS)
    const nextRows = clampSize(rows, 4, 200, DEFAULT_ROWS)
    const pty = await spawnPty(shell, cwd, nextCols, nextRows, this.deps.env ?? process.env)
    const session: Session = {
      cwd, shell, pty, buffer: '', cols: nextCols, rows: nextRows, listeners: new Set(),
    }
    this.sessions.set(key, session)
    pty.onData((chunk) => {
      this.emit(session, { type: 'out', text: chunk })
    })
    pty.onExit((event) => {
      if (this.sessions.get(key) !== session) return
      this.emit(session, { type: 'exit', code: event.exitCode })
      this.sessions.delete(key)
    })
    return session
  }
}
