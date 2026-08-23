/**
 * Vim ex-command bridge: :w / :q / :qa / :x / :wq / :vs / :sp / :only mapped
 * onto workbench editor-window behaviors (save, close tab, split panes).
 *
 * The vim engine only ships :write (a no-op here — CodeMirror's save command
 * is undefined) plus a few non-window commands, so window/file commands would
 * answer "Not an editor command". We register real handlers once per page on
 * the shared Vim instance; each CodeEditor instance registers its own ops
 * under its EditorView so commands act on the focused window even with split
 * panes.
 */
import type { EditorView } from '@codemirror/view'
import { Vim } from '@replit/codemirror-vim'
import type { EditorVimOps } from './types.ts'

const opsByView = new WeakMap<EditorView, EditorVimOps>()

export function installEditorVimOps(view: EditorView, ops: EditorVimOps): void {
  opsByView.set(view, ops)
}

export function uninstallEditorVimOps(view: EditorView): void {
  opsByView.delete(view)
}

function resolveOps(cm: { cm6?: EditorView | null }): EditorVimOps | undefined {
  const view = cm?.cm6
  if (view === undefined || view === null) return undefined
  return opsByView.get(view)
}

function forceOf(params: { argString?: string }): boolean {
  return /!/.test(params.argString ?? '')
}

let registered = false

/** Register :w/:q/:qa/:x/:wq/:vs/:sp/:only once. Idempotent; safe to call
 *  from every editor mount. */
export function ensureVimExCommands(): void {
  if (registered) return
  registered = true
  Vim.defineEx('write', 'w', (cm) => { void resolveOps(cm)?.save() })
  Vim.defineEx('quit', 'q', (cm, params) => { resolveOps(cm)?.close(forceOf(params)) })
  Vim.defineEx('qall', 'qa', (cm, params) => { resolveOps(cm)?.closeAll(forceOf(params)) })
  Vim.defineEx('xit', 'x', (cm, params) => { resolveOps(cm)?.writeQuit(forceOf(params)) })
  Vim.defineEx('wq', 'wq', (cm, params) => { resolveOps(cm)?.writeQuit(forceOf(params)) })
  Vim.defineEx('vsplit', 'vs', (cm) => { resolveOps(cm)?.vsplit() })
  Vim.defineEx('split', 'sp', (cm) => { resolveOps(cm)?.hsplit() })
  Vim.defineEx('only', 'on', (cm) => { resolveOps(cm)?.only() })
}
