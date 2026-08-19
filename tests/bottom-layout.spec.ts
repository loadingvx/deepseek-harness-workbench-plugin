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
    expect(BOTTOM_SPANS).toEqual(['editor', 'right', 'full'])
    expect(isTermDock('tab')).toBe(true)
    expect(isTermDock('side')).toBe(false)
    expect(isBottomSpan('full')).toBe(true)
    expect(isBottomSpan('chat')).toBe(false)
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
    saveBottomSpan('full')
    saveTermPanelOpen(false)
    expect(loadTermDock()).toBe('bottom')
    expect(loadBottomSpan()).toBe('full')
    expect(loadTermPanelOpen()).toBe(false)
    expect(TERM_DOCK_KEY).toContain('term-dock')
    expect(BOTTOM_SPAN_KEY).toContain('bottom-span')
    expect(TERM_PANEL_OPEN_KEY).toContain('term-panel')
  })

  it('ignores junk in storage', () => {
    installStorage({ [TERM_DOCK_KEY]: 'popup', [BOTTOM_SPAN_KEY]: 'wide' })
    expect(loadTermDock()).toBe('bottom')
    expect(loadBottomSpan()).toBe('full')
  })
})

describe('layoutBottomSpan', () => {
  it('pins the status bar under editor and sidebar while the terminal is an editor tab', () => {
    expect(layoutBottomSpan('tab', 'full', { editor: true, side: true })).toBe('right')
    expect(layoutBottomSpan('tab', 'editor', { editor: true, side: true })).toBe('right')
  })

  it('matches the terminal span when the terminal is at the bottom', () => {
    expect(layoutBottomSpan('bottom', 'full', { editor: true, side: true })).toBe('full')
    expect(layoutBottomSpan('bottom', 'editor', { editor: true, side: true })).toBe('editor')
    expect(layoutBottomSpan('bottom', 'right', { editor: true, side: true })).toBe('right')
  })

  it('still avoids a 36px rail when the editor tab forces editor+sidebar', () => {
    expect(layoutBottomSpan('tab', 'full', { editor: false, side: false })).toBe('full')
  })
})

describe('effectiveBottomSpan', () => {
  it('keeps the choice when the matching columns are open', () => {
    expect(effectiveBottomSpan('editor', { editor: true, side: true })).toBe('editor')
    expect(effectiveBottomSpan('right', { editor: true, side: false })).toBe('right')
    expect(effectiveBottomSpan('full', { editor: false, side: false })).toBe('full')
  })

  it('does not park the bar on a 36px editor rail', () => {
    expect(effectiveBottomSpan('editor', { editor: false, side: true })).toBe('right')
    expect(effectiveBottomSpan('editor', { editor: false, side: false })).toBe('full')
  })

  it('stretches full width when both right columns are rails', () => {
    expect(effectiveBottomSpan('right', { editor: false, side: false })).toBe('full')
  })
})

describe('bottomSpanDisabledReason', () => {
  it('explains why editor-only is unavailable while the editor is collapsed', () => {
    expect(bottomSpanDisabledReason('editor', { editor: false, side: true }, t)).toBe('layout.span.editorDisabled')
    expect(bottomSpanDisabledReason('editor', { editor: true, side: false }, t)).toBe(null)
  })

  it('explains why right-span needs at least one open right column', () => {
    expect(bottomSpanDisabledReason('right', { editor: false, side: false }, t)).toBe('layout.span.rightDisabled')
    expect(bottomSpanDisabledReason('right', { editor: false, side: true }, t)).toBe(null)
  })

  it('locks width while the terminal is an editor tab', () => {
    expect(bottomSpanDisabledReason('full', { editor: true, side: true }, t, 'tab')).toBe('layout.span.tabLocked')
    expect(bottomSpanDisabledReason('full', { editor: true, side: true }, t, 'bottom')).toBe(null)
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
