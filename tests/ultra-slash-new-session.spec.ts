import { describe, expect, it, vi } from 'vitest'
import {
  createAndOpenSession,
  currentAgentPreset,
  formatSessionStartError,
  installNewSessionBridge,
  leadingCommandInput,
  leadingCommandName,
  newSlashMatchEnter,
  newSlashMatchSpace,
  pickAvailablePreset,
  resolveAgentPresetForNewSession,
  resolveTargetWorkspaceId,
  startNewSession,
} from '../src/client/ultra-slash/new-session.ts'
import type { SlashSource, SlashTriggerService } from '../src/client/ultra-slash/slash-menu.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'

function zhT(key: string, vars?: Record<string, string | number>): string {
  return translate('zh', key as keyof typeof import('../src/shared/ultra-slash/locales.ts').zh, vars)
}

/** Minimal mutable sessions+workspaces face that mirrors DSH list/current semantics. */
function makeSessionEnv(options?: {
  createFails?: boolean
  openThrows?: boolean
  openNoop?: boolean
  blankSessionId?: string
}) {
  let current: string | undefined = 's-old'
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const fn of listeners) fn()
  }
  const create = vi.fn(async (opts?: { workspaceId?: string }) => {
    if (options?.createFails) throw new Error(`create failed for ${opts?.workspaceId}`)
    return 's-new'
  })
  const open = vi.fn((id: string) => {
    if (options?.openThrows) throw new Error(`open failed for ${id}`)
    if (options?.openNoop) return
    current = id
    notify()
  })
  const openSession = vi.fn((id: string) => {
    open(id)
  })
  const prompt = vi.fn(async () => ({ ok: true }))
  const remote = {
    session: {
      create: vi.fn(async (req: { workspaceId?: string; agentPreset?: string }) => {
        const id = await create(req)
        return { ok: true, value: { sessionId: id } }
      }),
    },
    agentPresets: {
      list: vi.fn(async () => ({
        ok: true,
        value: { presets: [{ id: 'standard' }, { id: 'ptc' }, { id: 'minimal' }] },
      })),
    },
  }
  const blankId = options?.blankSessionId
  const sessionIds = blankId === undefined ? ['s-old'] : ['s-old', blankId]
  const byId: Record<string, { updatedAt: number; blank?: boolean; projectionValues?: { agentPreset: string } }> = {
    's-old': { updatedAt: 1, projectionValues: { agentPreset: 'ptc' } },
  }
  if (blankId !== undefined) {
    byId[blankId] = { updatedAt: 2, blank: true }
  }
  const sessions = {
    list: {
      getSnapshot: () => ({
        current,
        phase: 'ready' as const,
        ids: sessionIds,
        byId,
      }),
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    create,
    open,
    binding: (id: string) => (id === 's-new' || id === current
      ? { session: { prompt } }
      : undefined),
  }
  const workspaces = {
    list: {
      getSnapshot: () => ({
        phase: 'ready' as const,
        items: [{
          workspaceId: 'ws1',
          sessionIds: blankId === undefined ? ['s-old'] : ['s-old', blankId],
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      }),
    },
  }
  const openWorkspace = vi.fn(async (workspaceId: string, beforeOpen?: (id: string) => void) => {
    const id = await create({ workspaceId })
    beforeOpen?.(id)
    openSession(id)
  })
  const uiWorkspace = { openSession, openWorkspace, startSession: vi.fn() }
  const get = (name: string): unknown => {
    if (name === 'sessions') return sessions
    if (name === 'workspaces') return workspaces
    if (name === 'uiWorkspace') return uiWorkspace
    if (name === 'remote') return remote
    return undefined
  }
  return {
    get, create, open, openSession, openWorkspace, prompt, remote, sessions, uiWorkspace, readCurrent: () => current,
  }
}

describe('agent preset resolution', () => {
  it('uses the current session preset when it is still available', () => {
    const { get } = makeSessionEnv()
    expect(currentAgentPreset(get)).toBe('ptc')
    expect(resolveAgentPresetForNewSession(get, ['standard', 'ptc', 'minimal'])).toBe('ptc')
  })

  it('maps legacy code to ptc and falls back to standard', () => {
    expect(pickAvailablePreset('code', ['standard', 'ptc'])).toBe('ptc')
    expect(pickAvailablePreset('gone', ['standard', 'ptc'])).toBe('standard')
    expect(pickAvailablePreset(undefined, ['minimal'])).toBe('minimal')
  })
})

describe('formatSessionStartError', () => {
  it('maps agent-preset failures to a short preset hint', () => {
    const message = formatSessionStartError(
      new Error('session create failed: agent-preset/not-found: preset "code" not found (available: standard, minimal)'),
      zhT,
    )
    expect(message).toContain('「code」')
    expect(message).not.toContain('available')
  })
})

describe('leadingCommandName / leadingCommandInput', () => {
  it('parses the slash token and trailing text', () => {
    expect(leadingCommandName('/new')).toBe('new')
    expect(leadingCommandName('/new hello')).toBe('new')
    expect(leadingCommandInput('/new')).toBe('')
    expect(leadingCommandInput('/new hello')).toBe('hello')
  })
})

describe('resolveTargetWorkspaceId', () => {
  it('uses the workspace that owns the current session', () => {
    const { get } = makeSessionEnv()
    expect(resolveTargetWorkspaceId(get)).toBe('ws1')
  })
})

describe('createAndOpenSession', () => {
  it('creates then opens via uiWorkspace.openSession and switches current', async () => {
    const env = makeSessionEnv()
    const id = await createAndOpenSession(env.get, 'ws1')
    expect(id).toBe('s-new')
    expect(env.create).toHaveBeenCalledWith({ workspaceId: 'ws1' })
    expect(env.openSession).toHaveBeenCalledWith('s-new')
    expect(env.readCurrent()).toBe('s-new')
  })

  it('returns undefined when create fails (must not pretend success)', async () => {
    const env = makeSessionEnv({ createFails: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(createAndOpenSession(env.get, 'ws1')).resolves.toBeUndefined()
    expect(env.readCurrent()).toBe('s-old')
    warn.mockRestore()
  })

  it('returns undefined when open does not change current', async () => {
    const env = makeSessionEnv({ openNoop: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(createAndOpenSession(env.get, 'ws1')).resolves.toBeUndefined()
    expect(env.readCurrent()).toBe('s-old')
    warn.mockRestore()
  })
  it('still switches when open updates current on the next microtask', async () => {
    let current: string | undefined = 's-old'
    const listeners = new Set<() => void>()
    const notify = (): void => {
      for (const fn of listeners) fn()
    }
    const create = vi.fn(async () => 's-new')
    const open = vi.fn((id: string) => {
      queueMicrotask(() => {
        current = id
        notify()
      })
    })
    const get = (name: string): unknown => {
      if (name === 'sessions') {
        return {
          list: {
            getSnapshot: () => ({
              current,
              phase: 'ready' as const,
              byId: { 's-old': { updatedAt: 1 } },
            }),
            subscribe: (fn: () => void) => {
              listeners.add(fn)
              return () => { listeners.delete(fn) }
            },
          },
          create,
          open,
          binding: () => undefined,
        }
      }
      if (name === 'workspaces') {
        return {
          list: {
            getSnapshot: () => ({
              phase: 'ready' as const,
              items: [{
                workspaceId: 'ws1',
                sessionIds: ['s-old'],
                createdAt: '2026-01-01T00:00:00.000Z',
              }],
            }),
          },
        }
      }
      if (name === 'uiWorkspace') return { openSession: open }
      return undefined
    }
    const id = await createAndOpenSession(get, 'ws1')
    expect(id).toBe('s-new')
    expect(current).toBe('s-new')
  })
})

describe('startNewSession', () => {
  it('switches away from the old session before reporting ok', async () => {
    const env = makeSessionEnv()
    const result = await startNewSession(env.get, 'hello')
    expect(result).toEqual({ ok: true, sessionId: 's-new' })
    expect(env.readCurrent()).toBe('s-new')
    await vi.waitFor(() => expect(env.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'hello' }],
      'queue',
    ))
  })

  it('reuses blank without calling create when a blank session already exists', async () => {
    const env = makeSessionEnv({ blankSessionId: 's-blank' })
    env.sessions.binding = (id: string) => (id === 's-blank' || id === 's-new' || id === env.readCurrent()
      ? { session: { prompt: env.prompt } }
      : undefined)
    const result = await startNewSession(env.get, 'hello')
    expect(result).toEqual({ ok: true, sessionId: 's-blank' })
    expect(env.remote.session.create).not.toHaveBeenCalled()
    expect(env.readCurrent()).toBe('s-blank')
    await vi.waitFor(() => expect(env.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'hello' }],
      'queue',
    ))
  })

  it('falls back to startSession when openWorkspace and create both fail', async () => {
    const env = makeSessionEnv({ createFails: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    env.uiWorkspace.startSession = vi.fn(() => {
      env.open('s-new')
    })
    const result = await startNewSession(env.get, 'hello')
    expect(result).toEqual({ ok: true, sessionId: 's-new' })
    expect(env.uiWorkspace.startSession).toHaveBeenCalled()
    expect(env.readCurrent()).toBe('s-new')
    warn.mockRestore()
  })

  it('reports not ok only when create and startSession are both unavailable', async () => {
    const env = makeSessionEnv({ createFails: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    env.uiWorkspace.startSession = undefined as never
    const result = await startNewSession(env.get, 'hello')
    expect(result.ok).toBe(false)
    expect(env.readCurrent()).toBe('s-old')
    warn.mockRestore()
  })
})

describe('newSlashMatchEnter claim submit', () => {
  it('leaves bare /new to the command source', async () => {
    const matchEnter = newSlashMatchEnter(() => undefined, zhT)
    expect(await matchEnter({}, '/new', new AbortController().signal)).toBeUndefined()
  })

  it('claims /new hello and only succeeds after current switches', async () => {
    const env = makeSessionEnv()
    const matchEnter = newSlashMatchEnter(env.get, zhT)
    const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('hello')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('hello')
    expect(env.readCurrent()).toBe('s-new')
  })

  it('returns unavailable when navigation never settles', async () => {
    const env = makeSessionEnv({ openNoop: true })
    env.uiWorkspace.startSession = undefined as never
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const matchEnter = newSlashMatchEnter(env.get, zhT)
    const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('hello')
    expect(result).toEqual({ kind: 'error', text: zhT('new.unavailable') })
    expect(env.readCurrent()).toBe('s-old')
    warn.mockRestore()
  })

  it('creates with the current session preset via remote.session.create', async () => {
    const env = makeSessionEnv()
    const matchEnter = newSlashMatchEnter(env.get, zhT)
    const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('hello')
    expect(result.kind).toBe('success')
    expect(env.remote.session.create).toHaveBeenCalledWith({ workspaceId: 'ws1', agentPreset: 'ptc' })
  })

  it('surfaces errors when even the resolved preset cannot be created', async () => {
    const env = makeSessionEnv()
    env.remote.session.create = vi.fn(async () => ({
      ok: false,
      error: new Error('session create failed: agent-preset/not-found: preset "standard" not found (available: none)'),
    }))
    env.uiWorkspace.startSession = undefined as never
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const matchEnter = newSlashMatchEnter(env.get, zhT)
    const outcome = await matchEnter({}, '/new hello', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('hello')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('「standard」')
    warn.mockRestore()
  })

  it('creates via openSession when sessions.open is unavailable', async () => {
    let current: string | undefined = 's-old'
    const listeners = new Set<() => void>()
    const notify = (): void => {
      for (const fn of listeners) fn()
    }
    const create = vi.fn(async () => 's-new')
    const openSession = vi.fn((id: string) => {
      current = id
      notify()
    })
    const get = (name: string): unknown => {
      if (name === 'sessions') {
        return {
          list: {
            getSnapshot: () => ({
              current,
              phase: 'ready' as const,
              byId: { 's-old': { updatedAt: 1 } },
            }),
            subscribe: (fn: () => void) => {
              listeners.add(fn)
              return () => { listeners.delete(fn) }
            },
          },
          create,
          binding: () => undefined,
        }
      }
      if (name === 'workspaces') {
        return {
          list: {
            getSnapshot: () => ({
              phase: 'ready' as const,
              items: [{
                workspaceId: 'ws1',
                sessionIds: ['s-old'],
                createdAt: '2026-01-01T00:00:00.000Z',
              }],
            }),
          },
        }
      }
      if (name === 'uiWorkspace') return { openSession, startSession: vi.fn() }
      return undefined
    }
    const id = await createAndOpenSession(get, 'ws1')
    expect(id).toBe('s-new')
    expect(openSession).toHaveBeenCalledWith('s-new')
    expect(current).toBe('s-new')
  })
})

describe('newSlashMatchSpace', () => {
  it('claims /new with the ghost hint', () => {
    const env = makeSessionEnv()
    const matchSpace = newSlashMatchSpace(env.get, zhT)
    const outcome = matchSpace({}, '/new')
    const claim = (outcome as { claim: { token: string; hint: string } }).claim
    expect(claim.token).toBe('/new ')
    expect(claim.hint).toBe(zhT('new.hint'))
  })
})

describe('installNewSessionBridge', () => {
  it('starts a session after the command source claims /new', async () => {
    const start = vi.fn()
    const onPick = vi.fn(() => 'handled' as const)
    const matchEnter = vi.fn(async () => 'handled' as const)
    const source: SlashSource = {
      trigger: '/',
      name: 'command',
      candidates: async () => [],
      onPick,
      matchEnter,
    }
    const live: { sources: SlashSource[] } = { sources: [source] }
    const service: SlashTriggerService = {
      live,
      registerSource(src) {
        live.sources.push(src)
        return () => {}
      },
    }
    const stop = installNewSessionBridge(service, start)
    source.onPick({ candidate: { name: 'new' } })
    expect(start).toHaveBeenCalledWith('')
    await source.matchEnter?.({}, '/new', new AbortController().signal)
    expect(start).toHaveBeenCalledWith('')
    stop()
  })
})
