/**
 * CodeMirror decorations for Agent review hunks: soft add-line highlight,
 * a deleted-side preview widget, and Keep/Undo controls in the editor.
 */
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type Decoration as DecorationValue,
} from '@codemirror/view'
import type { ReviewHunk } from '../../shared/types.ts'

export interface ReviewEditorHunkHandlers {
  onKeep: (hunkId: string) => void
  onUndo: (hunkId: string) => void
  keepLabel: string
  undoLabel: string
  locked: boolean
  lockedHint: string
}

export interface ReviewEditorConfig {
  hunks: ReviewHunk[]
  handlers: ReviewEditorHunkHandlers
}

const setReviewConfig = StateEffect.define<ReviewEditorConfig | null>()

class HunkChromeWidget extends WidgetType {
  constructor(
    readonly hunkId: string,
    readonly deletedPreview: string,
    readonly handlers: ReviewEditorHunkHandlers,
  ) {
    super()
  }

  eq(other: HunkChromeWidget): boolean {
    return this.hunkId === other.hunkId
      && this.deletedPreview === other.deletedPreview
      && this.handlers.locked === other.handlers.locked
      && this.handlers.keepLabel === other.handlers.keepLabel
      && this.handlers.undoLabel === other.handlers.undoLabel
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div')
    root.className = 'cm-wb-review-chrome'
    root.setAttribute('data-hunk', this.hunkId)

    if (this.deletedPreview !== '') {
      const del = document.createElement('pre')
      del.className = 'cm-wb-review-del'
      del.textContent = this.deletedPreview
      root.appendChild(del)
    }

    const bar = document.createElement('div')
    bar.className = 'cm-wb-review-actions'
    if (this.handlers.locked) {
      const hint = document.createElement('span')
      hint.className = 'cm-wb-review-locked'
      hint.textContent = this.handlers.lockedHint
      bar.appendChild(hint)
    } else {
      const keep = document.createElement('button')
      keep.type = 'button'
      keep.className = 'cm-wb-review-btn'
      keep.textContent = this.handlers.keepLabel
      keep.addEventListener('mousedown', (event) => { event.preventDefault() })
      keep.addEventListener('click', () => { this.handlers.onKeep(this.hunkId) })
      const undo = document.createElement('button')
      undo.type = 'button'
      undo.className = 'cm-wb-review-btn cm-wb-review-btn-undo'
      undo.textContent = this.handlers.undoLabel
      undo.addEventListener('mousedown', (event) => { event.preventDefault() })
      undo.addEventListener('click', () => { this.handlers.onUndo(this.hunkId) })
      bar.appendChild(keep)
      bar.appendChild(undo)
    }
    root.appendChild(bar)
    return root
  }

  ignoreEvent(): boolean {
    return false
  }
}

function deletedOnlyPreview(hunk: ReviewHunk): string {
  if (hunk.oldText === null || hunk.oldText === '') return ''
  const oldLines = hunk.oldText.split('\n')
  const newSet = new Set(hunk.newText.split('\n'))
  const only = oldLines.filter(line => !newSet.has(line))
  if (only.length === 0) {
    return hunk.oldText.split('\n').map(line => `− ${line}`).join('\n')
  }
  return only.map(line => `− ${line}`).join('\n')
}

/**
 * Doc offsets of each review hunk (same needle rules as the decorations):
 * first unique occurrence of the hunk's newText, skipping empty needles.
 * Navigation (prev/next change, jump-to-first) and decorations share this so
 * the editor always scrolls to a position the chrome actually marks.
 */
export function reviewHunkPositions(docText: string, hunks: ReviewHunk[]): number[] {
  const out: number[] = []
  for (const hunk of hunks) {
    const needle = hunk.newText
    if (needle === '') continue
    const from = docText.indexOf(needle)
    if (from < 0) continue
    if (docText.indexOf(needle, from + Math.max(needle.length, 1)) >= 0) continue
    out.push(from)
  }
  return out
}

/** Jump the editor to the hunk at positions[index]: cursor + scroll into view. */
export function scrollEditorToReviewHunk(view: EditorView, positions: number[], index: number): void {
  const pos = positions[index]
  if (pos === undefined) return
  view.dispatch({
    selection: { anchor: pos, head: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 56 }),
  })
  view.focus()
}

function buildDecorations(docText: string, config: ReviewEditorConfig | null): DecrationsValue {
  if (config === null || config.hunks.length === 0) return Decoration.none
  type Mark = { at: number; order: number; deco: ReturnType<typeof Decoration.line> }
  const marks: Mark[] = []
  let order = 0
  const positions = reviewHunkPositions(docText, config.hunks)
  for (let i = 0; i < config.hunks.length; i++) {
    const hunk = config.hunks[i]!
    const from = positions[i]
    if (from === undefined) continue
    const needle = hunk.newText
    const to = from + needle.length
    marks.push({
      at: from,
      order: order++,
      deco: Decoration.widget({
        widget: new HunkChromeWidget(hunk.id, deletedOnlyPreview(hunk), config.handlers),
        side: -1,
        block: true,
      }),
    })
    let pos = from
    while (pos < to) {
      const lineEnd = docText.indexOf('\n', pos)
      const end = lineEnd === -1 || lineEnd >= to ? to : lineEnd
      marks.push({
        at: pos,
        order: order++,
        deco: Decoration.line({ class: 'cm-wb-review-add-line' }),
      })
      if (lineEnd === -1 || lineEnd >= to) break
      pos = lineEnd + 1
      void end
    }
  }
  marks.sort((a, b) => a.at - b.at || a.order - b.order)
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.line>>()
  for (const mark of marks) builder.add(mark.at, mark.at, mark.deco)
  return builder.finish()
}

const reviewField = StateField.define<{ config: ReviewEditorConfig | null; deco: DecrationsValue }>({
  create() {
    return { config: null, deco: Decoration.none }
  },
  update(value, tr) {
    let config = value.config
    for (const effect of tr.effects) {
      if (effect.is(setReviewConfig)) config = effect.value
    }
    if (config !== value.config || tr.docChanged) {
      return { config, deco: buildDecorations(tr.state.doc.toString(), config) }
    }
    return value
  },
  provide: field => EditorView.decorations.from(field, v => v.deco),
})

const reviewTheme = EditorView.theme({
  '.cm-wb-review-chrome': {
    margin: '4px 0 2px',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-interactive-bg-hover))',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '12px',
  },
  '.cm-wb-review-del': {
    margin: '0 0 6px',
    padding: 0,
    whiteSpace: 'pre-wrap',
    fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-state-error-primary, #c45c55)',
    background: 'transparent',
  },
  '.cm-wb-review-actions': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  '.cm-wb-review-locked': {
    color: 'var(--dsw-alias-state-warning-primary, #c98600)',
    fontSize: '11px',
  },
  '.cm-wb-review-btn': {
    appearance: 'none',
    height: '22px',
    padding: '0 8px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: '11px',
    cursor: 'pointer',
  },
  '.cm-wb-review-btn:hover': {
    background: 'var(--dsw-alias-interactive-bg-hover)',
  },
  '.cm-wb-review-btn-undo': {
    color: 'var(--dsw-alias-label-secondary)',
  },
  '.cm-wb-review-add-line': {
    backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #3d9a5b) 12%, transparent)',
  },
})

export function reviewEditorExtension(): Extension {
  return [reviewField, reviewTheme]
}

export function setReviewEditorConfig(view: EditorView, config: ReviewEditorConfig | null): void {
  view.dispatch({ effects: setReviewConfig.of(config) })
}
