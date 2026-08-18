import { describe, expect, it, vi } from 'vitest'
import { installNewSessionBridge, leadingCommandName, startNewSession } from '../src/client/ultra-slash/new-session.ts'
import type { SlashSource, SlashTriggerService } from '../src/client/ultra-slash/slash-menu.ts'

describe('leadingCommandName', () => {
  it('reads the slash token', () => {
    expect(leadingCommandName('/new')).toBe('new')
    expect(leadingCommandName('/new extra')).toBe('new')
    expect(leadingCommandName('new')).toBeUndefined()
  })
})

describe('startNewSession', () => {
  it('calls workspaces.startSession and does not throw when missing', () => {
    const startSession = vi.fn()
    expect(startNewSession((name) => name === 'workspaces' ? { startSession } : undefined)).toBe(true)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startNewSession(() => undefined)).toBe(false)
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
    expect(onPick).toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
    await source.matchEnter?.({}, '/new', new AbortController().signal)
    expect(start).toHaveBeenCalledTimes(2)
    stop()
    start.mockClear()
    source.onPick({ candidate: { name: 'new' } })
    expect(start).not.toHaveBeenCalled()
  })
})
