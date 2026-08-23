import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view'
import { workbenchEditorTheme } from './code-editor-theme.ts'
import { languageExtension, languageIdFromPath } from './code-language.ts'

export interface CodeEditorExtOptions {
  path: string
  label: string
  onSave: () => void
  onChange: (next: string) => void
  /** Called on every transaction (selection, doc, geometry) — used to sync UI. */
  onUpdate?: (update: ViewUpdate) => void
}

/**
 * The CodeMirror 6 extension set for the workbench editor.
 *
 * drawSelection() is essential: the vim plugin hides the browser's native
 * ::selection inside .cm-vimMode (its own fat-cursor layer only paints the
 * head), so without the CodeMirror selection layer, vim visual-mode selections
 * would be completely invisible. It also gives plain/emacs mode a consistent,
 * theme-driven selection background.
 */
export function workbenchEditorExtensions(opts: CodeEditorExtOptions): Extension[] {
  return [
    lineNumbers(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    languageExtension(languageIdFromPath(opts.path)),
    workbenchEditorTheme,
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { opts.onSave(); return true } },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      opts.onUpdate?.(update)
      if (update.docChanged) opts.onChange(update.state.doc.toString())
    }),
    EditorView.contentAttributes.of({ 'aria-label': opts.label }),
  ]
}
