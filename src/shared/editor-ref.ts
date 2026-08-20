/**
 * Official composer chip source for editor content (selections / whole file).
 * Draft holds U+FFFC; InputBar paints the chip; submit runs codec.serialize
 * which expands to the selected editor text for the model, with the file path
 * as context — the same mechanism terminal / network / file refs use.
 */
export const EDITOR_REF_SOURCE = 'workbench-editor'

export const EDITOR_REF_TRIGGER = '@' as const

export type EditorRefKind = 'selection' | 'file'

export interface EditorRefSnapshot {
  /** The text to hand the model (selection or whole draft). */
  readonly text: string
  /** File path the text came from; attached as context for the model. */
  readonly path?: string
  /** selection = the selected region; file = the whole buffer. */
  readonly kind: EditorRefKind
}

export interface EditorRefOccurrence {
  readonly ref?: string
  readonly label?: string
}

const PREFIX = 'ed1:'
const EDITOR_REF_LABEL_MAX = 48
const EDITOR_REF_TEXT_MAX = 20_000

export function clipEditorRefText(text: string): string {
  const t = String(text ?? '')
  return t.length <= EDITOR_REF_TEXT_MAX ? t : t.slice(0, EDITOR_REF_TEXT_MAX)
}

export function normalizeEditorRefSnapshot(raw: unknown): EditorRefSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const text = clipEditorRefText(String(rec.text ?? '')).trim()
  if (text === '') return null
  const kind = rec.kind === 'file' ? 'file' as const : 'selection' as const
  const path = clipEditorRefText(String(rec.path ?? '')).trim()
  return path === '' ? { text, kind } : { text, kind, path }
}

/** Short human label: the file path (or the first line for path-less text). */
export function editorRefLabelOf(snapshot: Pick<EditorRefSnapshot, 'text' | 'path'>): string {
  const path = String(snapshot.path ?? '').trim()
  if (path !== '') {
    const clipped = path.length <= EDITOR_REF_LABEL_MAX ? path : path.slice(0, EDITOR_REF_LABEL_MAX - 1) + '…'
    return clipped
  }
  const first = String(snapshot.text ?? '').split(/\r?\n/)[0] ?? ''
  const label = first.replace(/\s+/g, ' ').trim()
  if (label.length <= EDITOR_REF_LABEL_MAX) return label === '' ? '(编辑器内容)' : label
  return label.slice(0, EDITOR_REF_LABEL_MAX - 1) + '…'
}

/** Chip label. Same content already in the draft becomes `label · 2`. */
export function editorRefChipLabel(snapshot: Pick<EditorRefSnapshot, 'text' | 'path'>, existing: ReadonlyArray<EditorRefOccurrence>): string {
  const name = editorRefLabelOf(snapshot)
  const taken = new Set(
    existing
      .filter(row => typeof row.label === 'string' && row.label !== '')
      .map(row => row.label!),
  )
  if (!taken.has(name)) return name
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} · ${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${name} · ${Date.now()}`
}

export function encodeEditorRef(snapshot: EditorRefSnapshot): string {
  return PREFIX + encodeURIComponent(JSON.stringify(snapshot))
}

export function parseEditorRef(ref: string): EditorRefSnapshot | null {
  if (!ref.startsWith(PREFIX)) return null
  try {
    const raw = JSON.parse(decodeURIComponent(ref.slice(PREFIX.length))) as unknown
    return normalizeEditorRefSnapshot(raw)
  } catch {
    return null
  }
}

export function serializeEditorRef(snapshot: EditorRefSnapshot): string {
  const ctx = String(snapshot.path ?? '').trim()
  const prefix = snapshot.kind === 'file' ? '【文件内容】' : '【选中内容】'
  if (ctx === '') return `${prefix}\n---\n${snapshot.text}`
  return `${prefix}：${ctx}\n---\n${snapshot.text}`
}

export function serializeEditorRefRef(ref: string): string {
  const snapshot = parseEditorRef(ref)
  if (snapshot === null) {
    return '【编辑器内容】已过期，请重新选择后添加。'
  }
  return serializeEditorRef(snapshot)
}

export function clipboardEditorRef(ref: string): string {
  const snapshot = parseEditorRef(ref)
  return snapshot === null ? '' : serializeEditorRef(snapshot)
}

export function buildEditorReference(
  snapshot: EditorRefSnapshot,
  existing: ReadonlyArray<EditorRefOccurrence> = [],
): { source: typeof EDITOR_REF_SOURCE; ref: string; label: string; clipboardText: string } | null {
  const normalized = normalizeEditorRefSnapshot(snapshot)
  if (normalized === null) return null
  const ref = encodeEditorRef(normalized)
  return {
    source: EDITOR_REF_SOURCE,
    ref,
    label: editorRefChipLabel(normalized, existing),
    clipboardText: clipboardEditorRef(ref),
  }
}
