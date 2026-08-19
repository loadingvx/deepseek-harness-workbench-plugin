import { redactSecrets } from './redact.ts'

/** Official composer chip source for inspected browser elements. */
export const BROWSER_EL_SOURCE = 'workbench-browser-el'

export const BROWSER_EL_HTML_MAX = 48_000
export const BROWSER_EL_TEXT_MAX = 500

export interface BrowserElSnapshot {
  readonly tag: string
  readonly id: string
  readonly className: string
  readonly name: string
  readonly href: string
  readonly type: string
  readonly role: string
  readonly testId: string
  readonly xpath: string
  readonly cssPath: string
  readonly jsPath: string
  readonly text: string
  /** Original outer HTML. Required — never drop this field. */
  readonly html: string
  readonly htmlTruncated: boolean
  readonly url: string
  readonly title: string
}

export interface BrowserElOccurrence {
  readonly ref?: string
  readonly label?: string
}

const PREFIX = 'e1:'

export function clipBrowserHtml(html: string): { html: string; htmlTruncated: boolean } {
  if (html.length <= BROWSER_EL_HTML_MAX) return { html, htmlTruncated: false }
  return { html: html.slice(0, BROWSER_EL_HTML_MAX), htmlTruncated: true }
}

export function clipBrowserText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= BROWSER_EL_TEXT_MAX ? compact : compact.slice(0, BROWSER_EL_TEXT_MAX)
}

export function normalizeBrowserElTag(tag: string): string {
  const lower = tag.trim().toLowerCase()
  if (lower === '' || !/^[a-z][a-z0-9-]*$/.test(lower)) return 'el'
  return lower
}

/** Chip label: the outer tag only (`div`, `span`). Duplicates become `div · 2`. */
export function browserElChipLabel(tag: string, existing: ReadonlyArray<BrowserElOccurrence>): string {
  const name = normalizeBrowserElTag(tag)
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asBool(value: unknown): boolean {
  return value === true
}

export function normalizeBrowserElSnapshot(raw: unknown): BrowserElSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const html = asString(rec.html)
  if (html === '' && asString(rec.tag) === '') return null
  const clipped = clipBrowserHtml(html)
  return {
    tag: normalizeBrowserElTag(asString(rec.tag)),
    id: asString(rec.id),
    className: asString(rec.className),
    name: asString(rec.name),
    href: asString(rec.href),
    type: asString(rec.type),
    role: asString(rec.role),
    testId: asString(rec.testId),
    xpath: asString(rec.xpath),
    cssPath: asString(rec.cssPath),
    jsPath: asString(rec.jsPath),
    text: clipBrowserText(asString(rec.text)),
    html: clipped.html,
    htmlTruncated: clipped.htmlTruncated || asBool(rec.htmlTruncated),
    url: asString(rec.url),
    title: asString(rec.title),
  }
}

export function encodeBrowserEl(snapshot: BrowserElSnapshot): string {
  return PREFIX + encodeURIComponent(JSON.stringify(snapshot))
}

export function parseBrowserEl(ref: string): BrowserElSnapshot | null {
  if (!ref.startsWith(PREFIX)) return null
  try {
    const raw = JSON.parse(decodeURIComponent(ref.slice(PREFIX.length))) as unknown
    return normalizeBrowserElSnapshot(raw)
  } catch {
    return null
  }
}

function line(label: string, value: string): string | null {
  const text = value.trim()
  if (text === '') return null
  return `${label}: ${redactSecrets(text)}`
}

/**
 * Model form. HTML is always present so the agent can see the original markup.
 */
export function serializeBrowserEl(snapshot: BrowserElSnapshot): string {
  const clipped = clipBrowserHtml(snapshot.html)
  const html = redactSecrets(clipped.html === '' ? '(空)' : clipped.html)
  const truncated = snapshot.htmlTruncated || clipped.htmlTruncated
  const rows = [
    '【浏览器元素】',
    line('页面', snapshot.url),
    line('标题', snapshot.title),
    `标签: ${snapshot.tag}`,
    line('id', snapshot.id),
    line('class', snapshot.className),
    line('name', snapshot.name),
    line('href', snapshot.href),
    line('type', snapshot.type),
    line('role', snapshot.role),
    line('data-testid', snapshot.testId),
    line('XPath', snapshot.xpath),
    line('CSS', snapshot.cssPath),
    line('JSPath', snapshot.jsPath),
    line('文本', snapshot.text),
    'HTML:',
    html,
    truncated ? '（HTML 过长，已截断。完整定位请用上面的 XPath / CSS / JSPath。）' : null,
  ]
  return rows.filter((row): row is string => row !== null).join('\n')
}

export function serializeBrowserElRef(ref: string): string {
  const snapshot = parseBrowserEl(ref)
  if (snapshot === null) {
    return '【浏览器元素】内容已过期，请在浏览器里重新点选。'
  }
  return serializeBrowserEl(snapshot)
}

export function clipboardBrowserEl(ref: string): string {
  const snapshot = parseBrowserEl(ref)
  if (snapshot === null) return ''
  return snapshot.xpath || snapshot.cssPath || snapshot.jsPath || snapshot.tag
}

export function buildBrowserElReference(
  snapshot: BrowserElSnapshot,
  existing: ReadonlyArray<BrowserElOccurrence> = [],
): { source: typeof BROWSER_EL_SOURCE; ref: string; label: string; clipboardText: string } | null {
  const normalized = normalizeBrowserElSnapshot(snapshot)
  if (normalized === null) return null
  if (normalized.html === '' && normalized.xpath === '' && normalized.cssPath === '') return null
  const ref = encodeBrowserEl(normalized)
  return {
    source: BROWSER_EL_SOURCE,
    ref,
    label: browserElChipLabel(normalized.tag, existing),
    clipboardText: clipboardBrowserEl(ref),
  }
}
