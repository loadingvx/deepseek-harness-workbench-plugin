import { describe, expect, it, vi } from 'vitest'
import {
  installNewSessionBridge,
  leadingCommandInput,
  leadingCommandName,
  newSlashMatchEnter,
  startNewSession,
} from '../src/client/ultra-slash/new-session.ts'
import type { SlashSource, SlashTriggerService } from '../src/client/ultra-slash/slash-menu.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'

function zhT(key: string, vars?: Record<string, string | number>): string {
  return translate('zh', key as keyof typeof import('../src/shared/ultra-slash/locales.ts').zh, vars)
}

describe('leadingCommandName', () => {
  it('reads the slash token', () => {
    expect(leadingCommandName('/new')).toBe('new')
    expect(leadingCommandName('/new extra')).toBe('new')
    expect(leadingCommandName('new')).toBeUndefined()
  })
})

describe('leadingCommandInput', () => {
  it('extracts the text after the command token', () => {
    expect(leadingCommandInput('/new')).toBe('')
    expect(leadingCommandInput('/new  ')).toBe('')
    expect(leadingCommandInput('/new 帮我写README')).toBe('帮我写README')
    expect(leadingCommandInput('/new   只列文件  ')).toBe('只列文件')
    expect(leadingCommandInput('/newtext')).toBe('')
    expect(leadingCommandInput('new 帮我写')).toBe('')
    expect(leadingCommandInput('/new 第一行\n第二行')).toBe('第一行\n第二行')
  })
})

describe('startNewSession', () => {
  it('calls workspaces.startSession and does not throw when missing', () => {
    const startSession = vi.fn()
    expect(startNewSession((name) => name === 'workspaces' ? { startSession } : undefined)).toBe(true)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startNewSession(() => undefined)).toBe(false)
  })

  it('starts a blank session without sending anything when there is no text', () => {
    const startSession = vi.fn()
    const prompt = vi.fn()
    const sessions = {
      list: { getSnapshot: () => ({ current: 's1' }), subscribe: vi.fn(() => () => {}) },
      binding: () => ({ session: { prompt } }),
    }
    const get = (name: string) => name === 'workspaces' ? { startSession } : name === 'sessions' ? sessions : undefined
    expect(startNewSession(get, '   ')).toBe(true)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('sends the trailing text as the first message in the new session', async () => {
    let current: string | undefined
    const listeners = new Set<() => void>()
    const prompt = vi.fn(async () => ({ ok: true }))
    const sessions = {
      list: {
        getSnapshot: () => ({ current }),
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      },
      binding: (id: string) => (id === 's2' ? { session: { prompt } } : undefined),
    }
    const startSession = vi.fn(() => {
      current = 's2'
      for (const fn of listeners) fn()
    })
    const get = (name: string) => name === 'workspaces' ? { startSession } : name === 'sessions' ? sessions : undefined
    expect(startNewSession(get, '  帮我写README ')).toBe(true)
    expect(startSession).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '帮我写README' }], 'queue')
  })

  it('does not send when the sessions service is unavailable', async () => {
    const startSession = vi.fn()
    expect(startNewSession((name) => name === 'workspaces' ? { startSession } : undefined, '帮我写')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(startSession).toHaveBeenCalledTimes(1)
  })
})

describe('newSlashMatchEnter', () => {
  it('claims /new with trailing text and starts the session on submit', async () => {
    const startSession = vi.fn()
    const get = (name: string) => name === 'workspaces' ? { startSession } : undefined
    const matchEnter = newSlashMatchEnter(get, zhT)
    const outcome = await matchEnter({}, '/new 帮我写README', new AbortController().signal)
    const claim = (outcome as { claim: { token: string; hint: string; submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    expect(claim.token).toBe('/new ')
    expect(claim.hint).toBe(zhT('new.hint'))
    const result = await claim.submit(' 帮我写README ')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('帮我写README')
    expect(startSession).toHaveBeenCalledTimes(1)
  })

  it('claims /new with empty args as a blank session', async () => {
    const startSession = vi.fn()
    const get = (name: string) => name === 'workspaces' ? { startSession } : undefined
    const matchEnter = newSlashMatchEnter(get, zhT)
    const outcome = await matchEnter({}, '/new ', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('')
    expect(result).toEqual({ kind: 'success', text: zhT('new.ok') })
    expect(startSession).toHaveBeenCalledTimes(1)
  })

  it('reports an error when workspaces are unavailable', async () => {
    const matchEnter = newSlashMatchEnter(() => undefined, zhT)
    const outcome = await matchEnter({}, '/new 帮我写', new AbortController().signal)
    const claim = (outcome as { claim: { submit: (args: string) => Promise<{ kind: string; text?: string }> } }).claim
    const result = await claim.submit('帮我写')
    expect(result).toEqual({ kind: 'error', text: zhT('new.unavailable') })
  })

  it('leaves non-/new lines alone', async () => {
    const matchEnter = newSlashMatchEnter(() => undefined, zhT)
    expect(await matchEnter({}, '/steer 只看测试', new AbortController().signal)).toBeUndefined()
    expect(await matchEnter({}, '帮我写', new AbortController().signal)).toBeUndefined()
  })
})

describe('installNewSessionBridge', () => {
  it('starts a session after the command source claims /new, passing the parsed text', async () => {
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
    expect(onPick).toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith('')
    await source.matchEnter?.({}, '/new', new AbortController().signal)
    expect(start).toHaveBeenCalledWith('')
    await source.matchEnter?.({}, '/new 帮我写', new AbortController().signal)
    expect(start).toHaveBeenCalledWith('帮我写')
    stop()
    start.mockClear()
    source.onPick({ candidate: { name: 'new' } })
    expect(start).not.toHaveBeenCalled()
  })
})
