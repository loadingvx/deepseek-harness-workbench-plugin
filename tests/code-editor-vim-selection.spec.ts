// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { workbenchEditorTheme } from '../src/client/workbench/code-editor-theme.ts'
import { workbenchEditorExtensions } from '../src/client/workbench/code-editor-extensions.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('vim mode + drawSelection', () => {
  it('keeps the CodeMirror selection layer active under .cm-vimMode', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'line one\nline two\nline three',
        extensions: [
          ...workbenchEditorExtensions({
            path: 'a.ts',
            label: 'a.ts',
            onSave: () => {},
            onChange: () => {},
          }),
          workbenchEditorTheme,
          vim(),
        ],
      }),
    })
    // Vim visual mode (v) sets a non-empty range on the CM6 selection; the
    // plugin only hides the native ::selection — drawSelection's layer must
    // still render the selected range.
    view.dispatch({ selection: { anchor: 0, head: 8 } })
    view.requestMeasure()
    expect(parent.querySelector('.cm-vimMode')).not.toBeNull()
    expect(parent.querySelector('.cm-selectionLayer')).not.toBeNull()
    view.destroy()
  })
})
