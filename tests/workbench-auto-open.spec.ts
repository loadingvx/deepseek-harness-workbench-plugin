import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultWorkbenchChrome,
  getWorkbenchChrome,
  patchWorkbenchChrome,
  resetWorkbenchChrome,
  shouldSplitWorkbench,
  workbenchOwnsPortal,
  workbenchShowsToggle,
} from '../src/client/workbench/auto-open.ts'

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
  })

  it('starts with the three columns open', () => {
    expect(defaultWorkbenchChrome()).toEqual({
      enabled: true,
      chatOpen: true,
      editorOpen: true,
      sideOpen: true,
    })
  })

  it('re-opens the full workbench when a new session starts', () => {
    patchWorkbenchChrome({ enabled: false, chatOpen: false, editorOpen: false, sideOpen: false })
    resetWorkbenchChrome()
    expect(getWorkbenchChrome()).toEqual(defaultWorkbenchChrome())
  })
})
