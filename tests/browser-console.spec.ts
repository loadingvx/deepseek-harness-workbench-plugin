import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureBrowserTab,
  patchBrowserTab,
  pushBrowserConsole,
  readActiveBrowserTab,
  readBrowserTab,
  requestBrowserEval,
  resetBrowserSession,
  upsertBrowserNetwork,
} from '../src/client/workbench/browser-session.ts'

describe('browser console session', () => {
  afterEach(() => {
    resetBrowserSession()
  })

  it('stores console lines with a kind, and queues eval for the iframe', () => {
    ensureBrowserTab('browser:1')
    pushBrowserConsole('browser:1', 'error', 'boom token=ghp_abcdefghijklmnopqrstuv')
    const logged = readBrowserTab('browser:1')
    expect(logged.console).toHaveLength(1)
    expect(logged.console[0]?.kind).toBe('log')
    expect(logged.console[0]?.level).toBe('error')
    expect(logged.console[0]?.text).toContain('***')
    expect(logged.console[0]?.text).not.toContain('ghp_abcdefghijklmnopqrstuv')

    expect(requestBrowserEval('browser:1', '  document.title  ')).toBe(true)
    const next = readBrowserTab('browser:1')
    expect(next.console).toHaveLength(2)
    expect(next.console[1]?.kind).toBe('command')
    expect(next.console[1]?.text).toBe('document.title')
    expect(next.evalRequest).toEqual({ nonce: 1, code: 'document.title' })
  })

  it('ignores a blank eval', () => {
    ensureBrowserTab('browser:1')
    expect(requestBrowserEval('browser:1', '   ')).toBe(false)
    expect(readBrowserTab('browser:1').evalRequest).toBeNull()
  })

  it('returns a stable snapshot for useSyncExternalStore', () => {
    expect(readActiveBrowserTab()).toBe(readActiveBrowserTab())
    expect(readBrowserTab('missing')).toBe(readBrowserTab('missing'))
    ensureBrowserTab('browser:1')
    expect(readBrowserTab('browser:1')).toBe(readBrowserTab('browser:1'))
    patchBrowserTab('browser:1', { title: 'x' })
    const after = readBrowserTab('browser:1')
    expect(after.title).toBe('x')
    expect(readBrowserTab('browser:1')).toBe(after)
  })

  it('does not crash if an old tab is missing the console array', () => {
    ensureBrowserTab('browser:1')
    patchBrowserTab('browser:1', {
      console: undefined as unknown as [],
    })
    expect(readBrowserTab('browser:1').console).toEqual([])
    expect(() => {
      pushBrowserConsole('browser:1', 'log', 'ok')
    }).not.toThrow()
    expect(readBrowserTab('browser:1').console).toHaveLength(1)
  })

  it('stores network rows and hydrates missing inspect arrays', () => {
    ensureBrowserTab('browser:1')
    upsertBrowserNetwork('browser:1', {
      id: 1,
      method: 'GET',
      url: 'https://x.test/api?access_token=aaaaaaaaaaaaz',
      resourceType: 'fetch',
      status: 200,
      size: 12,
    })
    const first = readBrowserTab('browser:1')
    expect(first.network).toHaveLength(1)
    expect(first.network[0]?.url).toContain('***')
    expect(readBrowserTab('browser:1').network).toBe(first.network)

    patchBrowserTab('browser:1', {
      network: undefined as unknown as [],
      files: undefined as unknown as [],
    })
    expect(readBrowserTab('browser:1').network).toEqual([])
    expect(readBrowserTab('browser:1').files).toEqual([])
  })
})
