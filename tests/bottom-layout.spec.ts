import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOTTOM_SPAN_KEY,
  BOTTOM_SPANS,
  DEFAULT_BOTTOM_SPAN,
  DEFAULT_TERM_DOCK,
  TERM_DEFAULT_H,
  TERM_DOCK_KEY,
  TERM_DOCKS,
  TERM_MIN_H,
  TERM_PANEL_OPEN_KEY,
  bottomSpanDisabledReason,
  clampTermHeight,
  effectiveBottomSpan,
  fileTabsOf,
  layoutBottomSpan,
  isBottomSpan,
  isTermDock,
  loadBottomSpan,
  loadTermDock,
  loadTermPanelOpen,
  pickTabId,
  reservedAboveTerm,
  saveBottomSpan,
  saveTermDock,
  saveTermPanelOpen,
  statusBarVisibleTabs,
  termPanelVisible,
  termTabsOf,
  visibleTermId,
} from '../src/client/workbench/bottom-layout.ts'
import { STATUS_BAR_H } from '../src/client/workbench/status-bar.ts'
import { createTerminalTab, TERMINAL_TAB_ID, type FileTab } from '../src/client/workbench/types.ts'

function installStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => { store.set(key, value) },
    removeItem: (key: string): void => { store.delete(key) },
  })
}

const t = (key: string): string => key

const fileA: FileTab = { id: 'file:a.ts', kind: 'file', path: 'a.ts', title: 'a.ts' }
const fileB: FileTab = { id: 'file:b.ts', kind: 'file', path: 'b.ts', title: 'b.ts' }
const term2: FileTab = { id: 'terminal:2', kind: 'terminal', path: '', title: '', termIndex: 2 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('term dock and bottom span ids', () => {
  it('accepts the two docks and three spans', () => {
    expect(TERM_DOCKS).toEqual(['tab', 'bottom'])
    expect(BOTTOM_SPANS).toEqual(['chat', 'side', 'full'])
    expect(isTermDock('tab')).toBe(true)
    expect(isTermDock('side')).toBe(false)
    expect(isBottomSpan('full')).toBe(true)
    expect(isBottomSpan('chat')).toBe(true)
    expect(isBottomSpan('editor')).toBe(false)
  })
})

describe('persistence', () => {
  it('falls back to factory defaults', () => {
    installStorage()
    expect(DEFAULT_TERM_DOCK).toBe('bottom')
    expect(DEFAULT_BOTTOM_SPAN).toBe('full')
    expect(loadTermDock()).toBe(DEFAULT_TERM_DOCK)
    expect(loadBottomSpan()).toBe(DEFAULT_BOTTOM_SPAN)
    expect(loadTermPanelOpen()).toBe(true)
  })

  it('round-trips dock, span and panel collapse', () => {
    installStorage()
    saveTermDock('bottom')
    saveBottomSpan('chat')
    saveTermPanelOpen(false)
    expect(loadTermDock()).toBe('bottom')
    expect(loadBottomSpan()).toBe('chat')
    expect(loadTermPanelOpen()).toBe(false)
    expect(TERM_DOCK_KEY).toContain('term-dock')
    expect(BOTTOM_SPAN_KEY).toContain('bottom-span')
    expect(TERM_PANEL_OPEN_KEY).toContain('term-panel')
  })

  it('migrates retired v2 span keys', () => {
    installStorage({ 'dsh-workbench-bottom-span-v2': 'editor' })
    expect(loadBottomSpan()).toBe('chat')
    installStorage({ 'dsh-workbench-bottom-span-v2': 'right' })
    expect(loadBottomSpan()).toBe('side')
  })

  it('ignores junk in storage', () => {
    installStorage({ [TERM_DOCK_KEY]: 'popup', [BOTTOM_SPAN_KEY]: 'wide' })
    expect(loadTermDock()).toBe('bottom')
    expect(loadBottomSpan()).toBe('full')
  })
})

describe('layoutBottomSpan', () => {
  it('keeps the chosen span when columns allow it', () => {
    expect(layoutBottomSpan('bottom', 'full', { side: true })).toBe('full')
    expect(layoutBottomSpan('bottom', 'chat', { side: true })).toBe('chat')
    expect(layoutBottomSpan('bottom', 'side', { side: true })).toBe('side')
  })

  it('falls back from side when the side dock is closed', () => {
    expect(layoutBottomSpan('bottom', 'side', { side: false })).toBe('full')
  })
})

describe('effectiveBottomSpan', () => {
  it('keeps the choice when the matching columns are open', () => {
    expect(effectiveBottomSpan('chat', { side: true })).toBe('chat')
    expect(effectiveBottomSpan('side', { side: true })).toBe('side')
    expect(effectiveBottomSpan('full', { side: false })).toBe('full')
  })

  it('does not park the bar on a missing side column', () => {
    expect(effectiveBottomSpan('side', { side: false })).toBe('full')
  })
})

describe('bottomSpanDisabledReason', () => {
  it('explains why side-only needs the side dock', () => {
    expect(bottomSpanDisabledReason('side', { side: false }, t)).toBe('layout.span.sideDisabled')
    expect(bottomSpanDisabledReason('side', { side: true }, t)).toBe(null)
  })

  it('never locks chat or full', () => {
    expect(bottomSpanDisabledReason('chat', { side: false }, t)).toBe(null)
    expect(bottomSpanDisabledReason('full', { side: false }, t)).toBe(null)
  })
})

describe('clampTermHeight', () => {
  it('keeps a mid-size panel', () => {
    expect(clampTermHeight(220, 900, reservedAboveTerm(900))).toBe(220)
  })

  it('never grows past the saved drag when the window is tall', () => {
    expect(clampTermHeight(180, 1400, reservedAboveTerm(1400))).toBe(180)
  })

  it('shrinks when the window cannot fit the saved height', () => {
    const host = 280
    const next = clampTermHeight(400, host, reservedAboveTerm(host))
    expect(next).toBeLessThanOrEqual(Math.round(host * 0.55))
    expect(next).toBeGreaterThanOrEqual(Math.min(TERM_MIN_H, next))
  })

  it('accounts for the status bar in the reserved strip', () => {
    expect(reservedAboveTerm(800)).toBe(STATUS_BAR_H + 120)
  })

  it('falls back to the default when the saved value is garbage', () => {
    expect(clampTermHeight(Number.NaN, 900, reservedAboveTerm(900))).toBe(TERM_DEFAULT_H)
  })
})

describe('tab helpers', () => {
  it('splits file tabs from terminal tabs', () => {
    const tabs = [createTerminalTab(), fileA, term2, fileB]
    expect(fileTabsOf(tabs).map(tab => tab.id)).toEqual(['file:a.ts', 'file:b.ts'])
    expect(termTabsOf(tabs).map(tab => tab.id)).toEqual([TERMINAL_TAB_ID, 'terminal:2'])
  })

  it('picks the wanted tab when it still exists', () => {
    expect(pickTabId([fileA, fileB], 'file:b.ts')).toBe('file:b.ts')
  })

  it('falls back to the last tab when the wanted one closed', () => {
    expect(pickTabId([fileA, fileB], 'file:gone.ts')).toBe('file:b.ts')
    expect(pickTabId([], 'file:a.ts')).toBe(null)
  })
})

describe('termPanelVisible', () => {
  it('keeps the bottom row even when the panel is collapsed to the tab strip', () => {
    expect(termPanelVisible('tab', true)).toBe(false)
    expect(termPanelVisible('bottom', false)).toBe(true)
    expect(termPanelVisible('bottom', true)).toBe(true)
  })
})

describe('statusBarVisibleTabs', () => {
  const tabs = [createTerminalTab(), fileA, term2]

  it('keeps every tab when the terminal lives in the editor', () => {
    expect(statusBarVisibleTabs(tabs, {
      editorOpen: true, termDock: 'tab',
    }).map(tab => tab.id)).toEqual([TERMINAL_TAB_ID, 'file:a.ts', 'terminal:2'])
  })

  it('hides the status-bar strip while the terminal sits at the bottom', () => {
    expect(statusBarVisibleTabs(tabs, {
      editorOpen: true, termDock: 'bottom',
    })).toEqual([])
    expect(statusBarVisibleTabs(tabs, {
      editorOpen: false, termDock: 'bottom',
    })).toEqual([])
  })

  it('hides the strip when the editor is a rail and the terminal is an editor tab', () => {
    expect(statusBarVisibleTabs(tabs, {
      editorOpen: false, termDock: 'tab',
    })).toEqual([])
  })
})

describe('visibleTermId', () => {
  const tabs = [createTerminalTab(), fileA, term2]

  it('follows the focused terminal immediately, not the previous one', () => {
    expect(visibleTermId(tabs, 'terminal:2', TERMINAL_TAB_ID)).toBe('terminal:2')
  })

  it('keeps the last terminal while a file is focused', () => {
    expect(visibleTermId(tabs, 'file:a.ts', 'terminal:2')).toBe('terminal:2')
  })

  it('falls back to the last remaining terminal when the wanted id is gone', () => {
    expect(visibleTermId(tabs, null, 'gone')).toBe('terminal:2')
  })

  it('uses the main terminal when it is the only one left', () => {
    expect(visibleTermId([createTerminalTab()], null, 'gone')).toBe(TERMINAL_TAB_ID)
  })
})
