/**
 * Official composer chip source for terminal selections / recent output.
 * Draft holds U+FFFC; InputBar paints the chip; submit runs codec.serialize
 * which expands to the selected terminal text for the model.
 */
export const TERM_REF_SOURCE = 'workbench-term'

export const TERM_REF_TRIGGER = '@' as const

export interface TermRefSnapshot {
  readonly text: string
  /** Shell context (pwd / shell) captured when the content was added to chat. */
  readonly context?: string
}

export interface TermRefOccurrence {
  readonly ref?: string
  readonly label?: string
}

const PREFIX = 't1:'
const TERM_REF_LABEL_MAX = 48
const TERM_REF_TEXT_MAX = 20_000

export function clipTermRefText(text: string): string {
  const t = String(text ?? '')
  return t.length <= TERM_REF_TEXT_MAX ? t : t.slice(0, TERM_REF_TEXT_MAX)
}

export function normalizeTermRefSnapshot(raw: unknown): TermRefSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const text = clipTermRefText(String(rec.text ?? '')).trim()
  if (text === '') return null
  const context = clipTermRefText(String(rec.context ?? '')).trim()
  return context === '' ? { text } : { text, context }
}

/** Short human label: first line, whitespace compacted, clamped. */
export function termRefLabelOf(text: string): string {
  const first = String(text ?? '').split(/\r?\n/)[0] ?? ''
  const label = first.replace(/\s+/g, ' ').trim()
  if (label.length <= TERM_REF_LABEL_MAX) return label === '' ? '(终端内容)' : label
  return label.slice(0, TERM_REF_LABEL_MAX - 1) + '…'
}

/** Chip label. Same content already in the draft becomes `label · 2`. */
export function termRefChipLabel(text: string, existing: ReadonlyArray<TermRefOccurrence>): string {
  const name = termRefLabelOf(text)
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

export function encodeTermRef(snapshot: TermRefSnapshot): string {
  return PREFIX + encodeURIComponent(JSON.stringify(snapshot))
}

export function parseTermRef(ref: string): TermRefSnapshot | null {
  if (!ref.startsWith(PREFIX)) return null
  try {
    const raw = JSON.parse(decodeURIComponent(ref.slice(PREFIX.length))) as unknown
    return normalizeTermRefSnapshot(raw)
  } catch {
    return null
  }
}

export function serializeTermRef(snapshot: TermRefSnapshot): string {
  const ctx = String(snapshot.context ?? '').trim()
  if (ctx === '') return snapshot.text
  return `【终端内容】${ctx}\n---\n${snapshot.text}`
}

export function serializeTermRefRef(ref: string): string {
  const snapshot = parseTermRef(ref)
  if (snapshot === null) {
    return '【终端内容】已过期，请在终端重新复制。'
  }
  return serializeTermRef(snapshot)
}

export function clipboardTermRef(ref: string): string {
  const snapshot = parseTermRef(ref)
  return snapshot === null ? '' : serializeTermRef(snapshot)
}

export function buildTermReference(
  snapshot: TermRefSnapshot,
  existing: ReadonlyArray<TermRefOccurrence> = [],
): { source: typeof TERM_REF_SOURCE; ref: string; label: string; clipboardText: string } | null {
  const normalized = normalizeTermRefSnapshot(snapshot)
  if (normalized === null) return null
  const ref = encodeTermRef(normalized)
  return {
    source: TERM_REF_SOURCE,
    ref,
    label: termRefChipLabel(normalized.text, existing),
    clipboardText: clipboardTermRef(ref),
  }
}
