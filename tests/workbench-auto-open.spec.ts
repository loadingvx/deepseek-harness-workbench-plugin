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

  it('starts with the editor collapsed and the files sidebar open', () => {
    expect(defaultWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: true,
      editorOpen: false,
      sideOpen: true,
      sideTab: 'files',
    })
    expect(DEFAULT_WORKBENCH_CHROME).toEqual(defaultWorkbenchChrome())
  })

  it('keeps collapsed columns when a new session would previously have reset them', () => {
    installStorage()
    patchWorkbenchChrome({ chatOpen: false, editorOpen: false, sideOpen: false, sideTab: 'git' })
    expect(getWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'git',
    })
  })

  it('writes collapse and side tab so a page reload restores them', () => {
    installStorage()
    patchWorkbenchChrome({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'git',
    })
    const saved = JSON.parse(localStorage.getItem(WORKBENCH_CHROME_KEY) ?? 'null') as unknown
    expect(parseWorkbenchChrome(saved)).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'git',
    })
    resetWorkbenchChrome()
    expect(getWorkbenchChrome()).toEqual(defaultWorkbenchChrome())
    localStorage.setItem(WORKBENCH_CHROME_KEY, JSON.stringify(saved))
    expect(hydrateWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: false,
      editorOpen: false,
      sideOpen: false,
      sideTab: 'git',
    })
  })
})

describe('parseWorkbenchChrome', () => {
  it('fills missing fields and rejects invalid side tabs', () => {
    expect(parseWorkbenchChrome(null)).toEqual(DEFAULT_WORKBENCH_CHROME)
    expect(parseWorkbenchChrome({ editorOpen: true })).toEqual({
      ...DEFAULT_WORKBENCH_CHROME,
      editorOpen: true,
    })
    expect(parseWorkbenchChrome({ sideTab: 'nope', sideOpen: false })).toEqual({
      ...DEFAULT_WORKBENCH_CHROME,
      sideOpen: false,
    })
    expect(isSideTab('usage')).toBe(true)
    expect(isSideTab('slash')).toBe(true)
    expect(isSideTab('devtools')).toBe(true)
    expect(isSideTab('nope')).toBe(false)
  })
})
