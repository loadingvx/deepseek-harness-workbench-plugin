import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKBENCH_CHROME,
  defaultWorkbenchChrome,
  getWorkbenchChrome,
  hydrateWorkbenchChrome,
  isSideTab,
  parseWorkbenchChrome,
  patchWorkbenchChrome,
  resetWorkbenchChrome,
  shouldSplitWorkbench,
  WORKBENCH_CHROME_KEY,
  workbenchOwnsPortal,
  workbenchShowsToggle,
} from '../src/client/workbench/auto-open.ts'

function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => { store.set(key, value) },
    removeItem: (key: string): void => { store.delete(key) },
  }
  vi.stubGlobal('localStorage', localStorage)
  return store
}

describe('shouldSplitWorkbench', () => {
  it('opens on a blank new-session hero, not only after the first prompt', () => {
    expect(shouldSplitWorkbench(true, true)).toBe(true)
    expect(shouldSplitWorkbench(true, false)).toBe(true)
  })

  it('stays closed when the user turned workbench off', () => {
    expect(shouldSplitWorkbench(false, true)).toBe(false)
    expect(shouldSplitWorkbench(false, false)).toBe(false)
  })
})

describe('workbench mounts', () => {
  it('puts the IDE portal on the host and the button on the header toggle', () => {
    expect(workbenchOwnsPortal('host')).toBe(true)
    expect(workbenchOwnsPortal('toggle')).toBe(false)
    expect(workbenchShowsToggle('toggle')).toBe(true)
    expect(workbenchShowsToggle('host')).toBe(false)
  })
})

describe('workbench chrome', () => {
  afterEach(() => {
    resetWorkbenchChrome()
    vi.unstubAllGlobals()
  })

  it('starts with the editor and legacy SideDock collapsed', () => {
    expect(defaultWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: true,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'settings',
    })
    expect(DEFAULT_WORKBENCH_CHROME).toEqual(defaultWorkbenchChrome())
  })

  it('keeps collapsed columns when a new session would previously have reset them', () => {
    installStorage()
    patchWorkbenchChrome({ chatOpen: false, editorOpen: true, sideOpen: false, sideTab: 'settings' })
    expect(getWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'settings',
    })
  })

  it('writes collapse and side tab so a page reload restores them', () => {
    installStorage()
    patchWorkbenchChrome({
      enabled: true,
      chatOpen: false,
      editorOpen: true,
      sideOpen: false,
      sideTab: 'settings',
    })
    const saved = JSON.parse(localStorage.getItem(WORKBENCH_CHROME_KEY) ?? 'null') as unknown
    expect(parseWorkbenchChrome(saved)).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'settings',
    })
    resetWorkbenchChrome()
    expect(getWorkbenchChrome()).toEqual(defaultWorkbenchChrome())
    localStorage.setItem(WORKBENCH_CHROME_KEY, JSON.stringify(saved))
    expect(hydrateWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'settings',
    })
  })
})

describe('parseWorkbenchChrome', () => {
  it('fills missing fields and rejects invalid side tabs', () => {
    expect(parseWorkbenchChrome(null)).toEqual(DEFAULT_WORKBENCH_CHROME)
    expect(parseWorkbenchChrome({ editorOpen: true })).toEqual({
      ...DEFAULT_WORKBENCH_CHROME,
      editorOpen: false,
    })
    expect(parseWorkbenchChrome({ sideTab: 'nope', sideOpen: false })).toEqual({
      ...DEFAULT_WORKBENCH_CHROME,
      sideOpen: false,
    })
    expect(parseWorkbenchChrome({ sideTab: 'files' })).toEqual(DEFAULT_WORKBENCH_CHROME)
    expect(isSideTab('settings')).toBe(true)
    expect(isSideTab('devtools')).toBe(true)
    expect(isSideTab('files')).toBe(false)
    expect(isSideTab('usage')).toBe(false)
    expect(isSideTab('nope')).toBe(false)
  })
})
