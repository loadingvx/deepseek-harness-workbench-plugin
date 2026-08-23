import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GRAPH_COMPACT,
  DEFAULT_GRAPH_OPEN,
  DEFAULT_TERM_AI_OPEN,
  GRAPH_COMPACT_KEY,
  GRAPH_OPEN_KEY,
  GIT_SETTINGS_OPEN_KEY,
  TERM_AI_OPEN_KEY,
  TERM_AI_SETTINGS_OPEN_KEY,
  readBoolFlag,
  writeBoolFlag,
} from '../src/client/workbench/ui-flags.ts'

function installStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => { store.set(key, value) },
    removeItem: (key: string): void => { store.delete(key) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ui flags', () => {
  it('falls back when nothing is stored', () => {
    installStorage()
    expect(readBoolFlag(GRAPH_COMPACT_KEY, DEFAULT_GRAPH_COMPACT)).toBe(true)
    expect(readBoolFlag(GRAPH_OPEN_KEY, DEFAULT_GRAPH_OPEN)).toBe(true)
    expect(readBoolFlag(TERM_AI_OPEN_KEY, DEFAULT_TERM_AI_OPEN)).toBe(false)
    expect(readBoolFlag(GIT_SETTINGS_OPEN_KEY, false)).toBe(false)
  })

  it('round-trips compact, git settings, and Alt+I agent open', () => {
    installStorage()
    writeBoolFlag(GRAPH_COMPACT_KEY, false)
    writeBoolFlag(GIT_SETTINGS_OPEN_KEY, true)
    writeBoolFlag(TERM_AI_OPEN_KEY, true)
    writeBoolFlag(TERM_AI_SETTINGS_OPEN_KEY, true)
    expect(readBoolFlag(GRAPH_COMPACT_KEY, DEFAULT_GRAPH_COMPACT)).toBe(false)
    expect(readBoolFlag(GIT_SETTINGS_OPEN_KEY, false)).toBe(true)
    expect(readBoolFlag(TERM_AI_OPEN_KEY, DEFAULT_TERM_AI_OPEN)).toBe(true)
    expect(readBoolFlag(TERM_AI_SETTINGS_OPEN_KEY, false)).toBe(true)
  })

  it('defaults GRAPH to compact on', () => {
    expect(DEFAULT_GRAPH_COMPACT).toBe(true)
  })
})
