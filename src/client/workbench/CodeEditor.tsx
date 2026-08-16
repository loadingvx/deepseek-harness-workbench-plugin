import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { workbenchEditorTheme } from './code-editor-theme.ts'
import { languageExtension, languageIdFromPath } from './code-language.ts'
import { editorModeExtensions, type EditorModeId } from './editor-mode.ts'
import css from './EditorPane.module.css'

export function CodeEditor({
  path, value, onChange, onSave, label, mode,
}: {
  path: string
  value: string
  onChange: (next: string) => void
  onSave: () => void
  label: string
  mode: EditorModeId
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const modeCompartmentRef = useRef<Compartment | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const applyingRef = useRef(false)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    const parent = hostRef.current
    if (parent === null) return
    const modeCompartment = new Compartment()
    modeCompartmentRef.current = modeCompartment
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          languageExtension(languageIdFromPath(path)),
          workbenchEditorTheme,
          modeCompartment.of(editorModeExtensions(mode)),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current(); return true } },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (applyingRef.current || !update.docChanged) return
            onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.contentAttributes.of({ 'aria-label': label }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
      modeCompartmentRef.current = null
    }
  }, [path, label])

  useEffect(() => {
    const view = viewRef.current
    const compartment = modeCompartmentRef.current
    if (view === null || compartment === null) return
    view.dispatch({ effects: compartment.reconfigure(editorModeExtensions(mode)) })
  }, [mode])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (view.state.doc.toString() === value) return
    applyingRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
    applyingRef.current = false
  }, [value])

  return <div ref={hostRef} className={css.cmHost} data-path={path} />
}
