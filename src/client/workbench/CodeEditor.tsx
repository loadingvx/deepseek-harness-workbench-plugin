import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReviewHunk } from '../../shared/types.ts'
import { workbenchEditorExtensions } from './code-editor-extensions.ts'
import { editorModeExtensions, type EditorModeId } from './editor-mode.ts'
import { ensureVimExCommands, installEditorVimOps, uninstallEditorVimOps } from './editor-vim-commands.ts'
import { IconChat } from './icons.tsx'
import {
  reviewEditorExtension,
  reviewHunkPositions,
  scrollEditorToReviewHunk,
  setReviewEditorConfig,
  type ReviewEditorConfig,
} from './review-cm.ts'
import type { EditorVimOps, Translate } from './types.ts'
import css from './EditorPane.module.css'

interface SelSnapshot {
  text: string
  left: number
  top: number
}

export interface CodeEditorReviewProps {
  hunks: ReviewHunk[]
  manualEdited: boolean
  onKeepHunk: (hunkId: string) => void
  onUndoHunk: (hunkId: string) => void
}

/** Jump request for the review-bar prev/next-change buttons (and jump-to-first). */
export interface CodeEditorReviewNav {
  /** Index into the review hunks to scroll to. */
  index: number
  /** Monotonic stamp so repeated jumps to the same index re-trigger. */
  stamp: number
}

export function CodeEditor({
  path, value, onChange, onSave, onAddToChat, vimOps, label, mode, t, review, reviewNav = null,
}: {
  path: string
  value: string
  onChange: (next: string) => void
  onSave: () => void
  onAddToChat?: (text: string, kind: 'selection' | 'file') => boolean
  vimOps?: EditorVimOps
  label: string
  mode: EditorModeId
  t: Translate
  review?: CodeEditorReviewProps
  reviewNav?: CodeEditorReviewNav | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const modeCompartmentRef = useRef<Compartment | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onAddToChatRef = useRef(onAddToChat)
  const reviewRef = useRef(review)
  const applyingRef = useRef(false)
  const selRef = useRef<SelSnapshot | null>(null)
  const [sel, setSel] = useState<SelSnapshot | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onAddToChatRef.current = onAddToChat
  reviewRef.current = review

  const syncSelection = useCallback((state: EditorState): void => {
    const view = viewRef.current
    const host = hostRef.current
    if (view === null || host === null) return
    const main = state.selection.main
    if (main.empty) {
      selRef.current = null
      setSel(null)
      return
    }
    const text = state.sliceDoc(main.from, main.to)
    if (text === '') {
      selRef.current = null
      setSel(null)
      return
    }
    const coords = view.coordsAtPos(main.head, 1) ?? view.coordsAtPos(main.from)
    if (coords === null) {
      selRef.current = null
      setSel(null)
      return
    }
    const hostRect = host.getBoundingClientRect()
    const next: SelSnapshot = {
      text,
      left: Math.round(coords.left - hostRect.left),
      top: Math.round(coords.bottom - hostRect.top + 8),
    }
    selRef.current = next
    setSel(next)
  }, [])

  useEffect(() => {
    const parent = hostRef.current
    if (parent === null) return
    ensureVimExCommands()
    const modeCompartment = new Compartment()
    modeCompartmentRef.current = modeCompartment
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...workbenchEditorExtensions({
            path,
            label,
            onSave: () => { onSaveRef.current() },
            onChange: (next) => { if (!applyingRef.current) onChangeRef.current(next) },
            onUpdate: (update) => {
              if (applyingRef.current) return
              if (update.selectionSet || update.docChanged || update.geometryChanged) syncSelection(update.state)
            },
          }),
          modeCompartment.of(editorModeExtensions(mode)),
          reviewEditorExtension(),
        ],
      }),
    })
    viewRef.current = view
    const onScroll = (): void => syncSelection(view.state)
    view.scrollDOM.addEventListener('scroll', onScroll)
    view.focus()
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll)
      view.destroy()
      viewRef.current = null
      modeCompartmentRef.current = null
    }
  }, [path, label, syncSelection])

  useEffect(() => {
    const view = viewRef.current
    if (view === null || vimOps === undefined) return
    installEditorVimOps(view, vimOps)
    return () => { uninstallEditorVimOps(view) }
  }, [vimOps])

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

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = reviewRef.current
    const config: ReviewEditorConfig | null = current === undefined
      ? null
      : {
        hunks: current.hunks,
        handlers: {
          onKeep: (id) => { reviewRef.current?.onKeepHunk(id) },
          onUndo: (id) => { reviewRef.current?.onUndoHunk(id) },
          keepLabel: t('review.keepHunk'),
          undoLabel: t('review.undoHunk'),
          locked: current.manualEdited,
          lockedHint: t('review.hunkLocked'),
        },
      }
    setReviewEditorConfig(view, config)
  }, [review, t, value, path])

  /** Review-bar navigation: scroll the editor to the requested hunk index. */
  useEffect(() => {
    const view = viewRef.current
    if (view === null || reviewNav === null) return
    const current = reviewRef.current
    if (current === undefined) return
    const positions = reviewHunkPositions(view.state.doc.toString(), current.hunks)
    scrollEditorToReviewHunk(view, positions, reviewNav.index)
  }, [reviewNav])

  useEffect(() => () => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
  }, [])

  const flashMsg = (labelText: string): void => {
    setFlash(labelText)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setFlash(null) }, 1600)
  }

  const addSelectionToChat = (): void => {
    const snapshot = selRef.current
    if (snapshot === null) return
    const ok = onAddToChatRef.current?.(snapshot.text, 'selection') === true
    if (ok) flashMsg(t('editor.addedToChat'))
    const view = viewRef.current
    if (view !== null) {
      view.dispatch({ selection: { anchor: view.state.selection.main.head } })
    }
    selRef.current = null
    setSel(null)
  }

  return (
    <div className={css.editorWrap}>
      <div ref={hostRef} className={css.cmHost} data-path={path} />
      {sel !== null && onAddToChat !== undefined ? (
        <button
          type="button"
          className={css.selChatBtn}
          style={{ left: sel.left, top: sel.top }}
          title={t('editor.menu.addSelToChat')}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={addSelectionToChat}
        >
          <IconChat />
          <span>{t('editor.menu.addToChat')}</span>
        </button>
      ) : null}
      {flash !== null ? <div className={css.copyFlash} role="status">{flash}</div> : null}
    </div>
  )
}
