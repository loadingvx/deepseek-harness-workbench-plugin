import {
  cursorGroupLeft,
  cursorGroupRight,
  deleteGroupBackward,
  deleteGroupForward,
  deleteToLineStart,
  emacsStyleKeymap,
  undo,
} from '@codemirror/commands'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'

/**
 * CodeMirror editing modes: which keymap the text editor uses.
 * 'plain' keeps the default CodeMirror keys; 'emacs' and 'vim' add
 * editor-style bindings. The choice is global (one editor, one mode)
 * and persisted in localStorage.
 */

export const EDITOR_MODES = ['plain', 'emacs', 'vim'] as const
export type EditorModeId = (typeof EDITOR_MODES)[number]

/** Default mode: emacs. Typing inserts characters normally, unlike vim's
 *  normal mode, so users unfamiliar with vim are never locked out. */
export const DEFAULT_EDITOR_MODE: EditorModeId = 'emacs'

const EDITOR_MODE_KEY = 'dsh-workbench-editor-mode'

export function isEditorModeId(value: string): value is EditorModeId {
  return (EDITOR_MODES as readonly string[]).includes(value)
}

export function loadEditorMode(): EditorModeId {
  try {
    const raw = window.localStorage.getItem(EDITOR_MODE_KEY)
    if (raw !== null && isEditorModeId(raw)) return raw
  } catch {
    // private mode / blocked storage
  }
  return DEFAULT_EDITOR_MODE
}

export function saveEditorMode(mode: EditorModeId): void {
  try {
    window.localStorage.setItem(EDITOR_MODE_KEY, mode)
  } catch {
    // ignore storage failures
  }
}

/**
 * Emacs-style bindings on top of the official emacsStyleKeymap:
 * word motions (Alt+F/B), word deletes (Alt+D / Alt+Backspace),
 * Ctrl+U as unix-line-discard, Ctrl+_ as undo. preventDefault keeps the
 * browser's Alt+Left/Back navigation shortcuts out of the editor.
 */
const emacsKeymap = Prec.high(keymap.of([
  ...emacsStyleKeymap,
  { key: 'Alt-f', run: cursorGroupRight, preventDefault: true },
  { key: 'Alt-b', run: cursorGroupLeft, preventDefault: true },
  { key: 'Alt-d', run: deleteGroupForward, preventDefault: true },
  { key: 'Alt-Backspace', run: deleteGroupBackward, preventDefault: true },
  { key: 'Ctrl-u', run: deleteToLineStart, preventDefault: true },
  { key: 'Ctrl-_', run: undo, preventDefault: true },
]))

/** CodeMirror extensions for a mode; empty for 'plain' (default keymap). */
export function editorModeExtensions(mode: EditorModeId): Extension {
  switch (mode) {
    case 'emacs':
      return emacsKeymap
    case 'vim':
      return vim()
    default:
      return []
  }
}
