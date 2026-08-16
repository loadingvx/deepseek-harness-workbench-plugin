import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  editorModeExtensions,
  isEditorModeId,
  loadEditorMode,
  saveEditorMode,
} from '../src/client/workbench/editor-mode.ts'

const KEY = 'dsh-workbench-editor-mode'

/** Provide a minimal window.localStorage for the browser-oriented helpers. */
function installStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string): void => { store.set(k, v) },
    removeItem: (k: string): void => { store.delete(k) },
  }
  vi.stubGlobal('window', { localStorage })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editor mode defaults', () => {
  it('defaults to emacs so typing works out of the box', () => {
    expect(DEFAULT_EDITOR_MODE).toBe('emacs')
  })

  it('exposes exactly plain / emacs / vim', () => {
    expect(EDITOR_MODES).toEqual(['plain', 'emacs', 'vim'])
  })
})

describe('isEditorModeId', () => {
  it('accepts the known ids', () => {
    for (const mode of EDITOR_MODES) expect(isEditorModeId(mode)).toBe(true)
  })

  it('rejects unknown ids', () => {
    expect(isEditorModeId('sublime')).toBe(false)
    expect(isEditorModeId('')).toBe(false)
    expect(isEditorModeId('Emacs')).toBe(false)
  })
})

describe('loadEditorMode', () => {
  it('falls back to emacs when nothing is stored', () => {
    installStorage()
    expect(loadEditorMode()).toBe('emacs')
  })

  it('reads a stored valid mode', () => {
    installStorage({ [KEY]: 'vim' })
    expect(loadEditorMode()).toBe('vim')
  })

  it('falls back to emacs for an invalid stored value', () => {
    installStorage({ [KEY]: 'notepad' })
    expect(loadEditorMode()).toBe('emacs')
  })

  it('falls back when storage is unavailable', () => {
    expect(loadEditorMode()).toBe('emacs')
  })
})

describe('saveEditorMode', () => {
  it('persists the choice for the next load', () => {
    installStorage()
    saveEditorMode('vim')
    expect(loadEditorMode()).toBe('vim')
    saveEditorMode('plain')
    expect(loadEditorMode()).toBe('plain')
  })
})

describe('editorModeExtensions', () => {
  it('adds nothing extra for plain', () => {
    expect(editorModeExtensions('plain')).toEqual([])
  })

  it('returns emacs keymap extensions', () => {
    expect(editorModeExtensions('emacs')).toBeTruthy()
  })

  it('returns vim extensions', () => {
    expect(editorModeExtensions('vim')).toBeTruthy()
  })
})
