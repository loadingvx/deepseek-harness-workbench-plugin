import { describe, expect, it } from 'vitest'
import { bottomChromeVisible, isDevtoolsDock, isDevtoolsPane, loadDevtoolsOpen } from '../src/client/workbench/browser-dock.ts'
import { isBottomTool } from '../src/client/workbench/bottom-layout.ts'
import { BROWSER_EL_SOURCE } from '../src/shared/browser-el.ts'
import { browserElExisting, installBrowserElClient } from '../src/client/workbench/browser-el-client.ts'
import { createBrowserTab, createTerminalTab } from '../src/client/workbench/types.ts'
import { fileTabsOf, termTabsOf } from '../src/client/workbench/bottom-layout.ts'

describe('bottomChromeVisible', () => {
  it('keeps the bottom strip for a bottom terminal or an open DevUtils tab', () => {
    expect(bottomChromeVisible('tab', true, { dock: 'side', open: true })).toBe(false)
    expect(bottomChromeVisible('bottom', true, { dock: 'side', open: false })).toBe(true)
    expect(bottomChromeVisible('tab', false, { dock: 'bottom', open: true })).toBe(true)
    expect(bottomChromeVisible('tab', true, { dock: 'bottom', open: false })).toBe(false)
    expect(isDevtoolsDock('side')).toBe(true)
    expect(isDevtoolsDock('editor')).toBe(false)
    expect(isDevtoolsPane('network')).toBe(true)
    expect(isDevtoolsPane('application')).toBe(true)
    expect(isDevtoolsPane('css')).toBe(true)
    expect(isDevtoolsPane('files')).toBe(true)
    expect(isDevtoolsPane('console')).toBe(true)
    expect(isDevtoolsPane('profiler')).toBe(false)
  })
})

describe('loadDevtoolsOpen', () => {
  it('always starts closed', () => {
    expect(loadDevtoolsOpen()).toBe(false)
  })
})

describe('bottom tool tab sits with the terminal', () => {
  it('only accepts terminal or devtools', () => {
    expect(isBottomTool('devtools')).toBe(true)
    expect(isBottomTool('terminal')).toBe(true)
    expect(isBottomTool('network')).toBe(false)
  })
})

describe('file tabs still include browser tabs', () => {
  it('does not treat a browser tab as a terminal', () => {
    const browser = createBrowserTab()
    const tabs = [createTerminalTab(), browser]
    expect(fileTabsOf(tabs).map(tab => tab.id)).toEqual([browser.id])
    expect(termTabsOf(tabs).map(tab => tab.id)).toEqual(['terminal:main'])
  })
})

describe('installBrowserElClient.insertChip', () => {
  it('inserts a chip whose serialized form keeps the original HTML', () => {
    const calls: unknown[] = []
    const actx = {
      bail(_thisArg: unknown, name: string, payload: unknown) {
        calls.push({ name, payload })
        return true
      },
      get() {
        return { input: { for: () => ({ snapshot: { occurrences: [] } }) } }
      },
    }
    const api = installBrowserElClient({
      effect: () => {},
      get: () => undefined,
      sessions: { scope: () => actx },
    })
    const t = (key: string) => key
    const html = '<button type="button">确定</button>'
    expect(api.insertChip({
      sessionId: 's1',
      snapshot: {
        tag: 'button',
        id: '',
        className: '',
        name: '',
        href: '',
        type: 'button',
        role: '',
        testId: '',
        xpath: '/html[1]/body[1]/button[1]',
        cssPath: 'button',
        jsPath: 'document.querySelector("button")',
        text: '确定',
        html,
        htmlTruncated: false,
        url: 'http://127.0.0.1:5173/',
        title: '本地',
      },
      span: { start: 0, end: 0, draftRev: 1 },
      existing: [],
      phase: 'plain',
    }, t)).toBe(true)
    const payload = (calls[0] as { payload: { reference: { source: string; label: string; ref: string } } }).payload
    expect(payload.reference.source).toBe(BROWSER_EL_SOURCE)
    expect(payload.reference.label).toBe('button')
    expect(browserElExisting([{ source: BROWSER_EL_SOURCE, ref: payload.reference.ref, label: 'button' }])).toHaveLength(1)
  })

  it('refuses while the composer is sending', () => {
    const notices: string[] = []
    const actx = {
      bail() { return true },
      get() {
        return {
          input: {
            for: () => ({
              notify: (_level: string, text: string) => { notices.push(text) },
            }),
          },
        }
      },
    }
    const api = installBrowserElClient({
      effect: () => {},
      get: () => undefined,
      sessions: { scope: () => actx },
    })
    expect(api.insertChip({
      sessionId: 's1',
      snapshot: {
        tag: 'div', id: '', className: '', name: '', href: '', type: '', role: '', testId: '',
        xpath: '/html[1]/body[1]/div[1]', cssPath: 'div', jsPath: 'document.querySelector("div")',
        text: '', html: '<div></div>', htmlTruncated: false, url: 'https://example.com/', title: '',
      },
      span: { start: 0, end: 0, draftRev: 1 },
      existing: [],
      phase: 'submitting',
    }, (key) => key)).toBe(false)
    expect(notices).toEqual(['browser.el.busy'])
  })
})
