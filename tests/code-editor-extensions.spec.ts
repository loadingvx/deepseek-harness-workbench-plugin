// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { workbenchEditorExtensions } from '../src/client/workbench/code-editor-extensions.ts'

function mount() {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const onChange = vi.fn()
  const onSave = vi.fn()
  const onUpdate = vi.fn()
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'line one\nline two\nline three',
      extensions: workbenchEditorExtensions({
        path: 'a.ts',
        label: 'a.ts',
        onSave,
        onChange,
        onUpdate,
      }),
    }),
  })
  return { parent, view, onChange, onSave, onUpdate }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('workbenchEditorExtensions', () => {
  it('mounts the CodeMirror selection layer so vim visual selections render', () => {
    const { parent, view } = mount()
    view.dispatch({ selection: { anchor: 0, head: 8 } })
    // The vim plugin hides the browser-native ::selection in .cm-vimMode; only
    // drawSelection's .cm-selectionLayer can paint the selected range.
    expect(parent.querySelector('.cm-selectionLayer')).not.toBeNull()
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(8)
    view.destroy()
  })

  it('keeps a real selection in vim mode (selection layer independent of keymap)', () => {
    const { parent, view } = mount()
    // Vim visual mode sets a non-empty CM6 selection range; the layer must
    // exist regardless of which keymap produced it.
    view.dispatch({ selection: { anchor: 9, head: 17 } })
    expect(parent.querySelector('.cm-selectionLayer')).not.toBeNull()
    expect(view.state.selection.main.to - view.state.selection.main.from).toBe(8)
    view.destroy()
  })

  it('reports document edits through onChange', () => {
    const { view, onChange } = mount()
    view.dispatch({ changes: { from: 0, insert: 'X' } })
    expect(onChange).toHaveBeenCalledWith('Xline one\nline two\nline three')
    view.destroy()
  })

  it('notifies onUpdate for selection and doc changes', () => {
    const { view, onUpdate } = mount()
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    expect(onUpdate).toHaveBeenCalled()
    view.destroy()
  })
})
