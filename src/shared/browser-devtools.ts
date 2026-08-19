import { redactSecrets } from './redact.ts'

export const BROWSER_NET_MAX = 200
export const BROWSER_FILES_MAX = 200
export const BROWSER_STORE_MAX = 80
export const BROWSER_VALUE_MAX = 500
export const BROWSER_CSS_SHEETS_MAX = 80
export const BROWSER_CSS_VARS_MAX = 80
export const BROWSER_URL_MAX = 1500

export const BROWSER_NET_TYPES = [
  'xhr',
  'fetch',
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
  'websocket',
  'document',
  'other',
] as const

export type BrowserNetType = (typeof BROWSER_NET_TYPES)[number]

export interface BrowserNetEntry {
  id: number
  method: string
  url: string
  resourceType: BrowserNetType
  status: number
  durationMs: number
  size: number
  pending: boolean
  failed: boolean
  startAt: number
  /** Request headers captured by the injected net hooks (name/value pairs, redacted + capped). */
  requestHeaders?: Array<[string, string]>
  /** Request body captured by the injected net hooks (best-effort, redacted + capped). */
  postData?: string
  /** The page route (address-bar URL) the request originated from. */
  pageUrl?: string
}

export interface BrowserStoreRow {
  name: string
  value: string
  truncated: boolean
}

export interface BrowserAppInfo {
  cookies: BrowserStoreRow[]
  localStorage: BrowserStoreRow[]
  sessionStorage: BrowserStoreRow[]
  databases: string[]
}

export interface BrowserCssSheet {
  href: string
  title: string
  disabled: boolean
  ruleCount: number | null
  blocked: boolean
}

export interface BrowserCssVar {
  name: string
  value: string
}

export interface BrowserFileEntry {
  url: string
  kind: BrowserNetType
  size: number
  durationMs: number
}

const NET_TYPE_SET = new Set<string>(BROWSER_NET_TYPES)
const METHOD_OK = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|WS)$/i

function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max), truncated: true }
}

function clipUrl(raw: string): string {
  return redactSecrets(clip(raw, BROWSER_URL_MAX).text)
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function classifyBrowserResource(initiatorType: string, url: string): BrowserNetType {
  const t = initiatorType.trim().toLowerCase()
  if (t === 'xmlhttprequest' || t === 'xhr') return 'xhr'
  if (t === 'fetch') return 'fetch'
  if (t === 'script') return 'script'
  if (t === 'link' || t === 'css' || t === 'stylesheet') return 'stylesheet'
  if (t === 'img' || t === 'image' || t === 'icon' || t === 'cssimage') return 'image'
  if (t === 'font') return 'font'
  if (t === 'video' || t === 'audio' || t === 'media') return 'media'
  if (t === 'websocket') return 'websocket'
  if (t === 'navigation' || t === 'iframe' || t === 'document') return 'document'
  const path = (url.split('?')[0] ?? '').toLowerCase()
  if (/\.(m?js|cjs)(\.map)?$/.test(path)) return 'script'
  if (/\.css$/.test(path)) return 'stylesheet'
  if (/\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/.test(path)) return 'image'
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font'
  if (/\.(mp4|webm|mp3|wav|ogg)$/.test(path)) return 'media'
  return 'other'
}

export function parseCookieString(raw: string): BrowserStoreRow[] {
  const rows: BrowserStoreRow[] = []
  if (raw.trim() === '') return rows
  for (const part of raw.split(';')) {
    const piece = part.trim()
    if (piece === '') continue
    const eq = piece.indexOf('=')
    const name = eq === -1 ? piece : piece.slice(0, eq)
    const value = eq === -1 ? '' : piece.slice(eq + 1)
    if (name === '') continue
    rows.push(normalizeStoreRow({ name, value, truncated: false }))
    if (rows.length >= BROWSER_STORE_MAX) break
  }
  return rows
}

function normalizeStoreRow(raw: unknown): BrowserStoreRow {
  const row = asRecord(raw)
  const name = clip(redactSecrets(String(row?.name ?? '')), 200).text
  const clipped = clip(redactSecrets(String(row?.value ?? '')), BROWSER_VALUE_MAX)
  return {
    name,
    value: clipped.text,
    truncated: Boolean(row?.truncated) || clipped.truncated,
  }
}

function normalizeStoreRows(raw: unknown): BrowserStoreRow[] {
  if (!Array.isArray(raw)) return []
  const rows: BrowserStoreRow[] = []
  for (const item of raw) {
    const row = normalizeStoreRow(item)
    if (row.name === '' && row.value === '') continue
    rows.push(row)
    if (rows.length >= BROWSER_STORE_MAX) break
  }
  return rows
}

export function normalizeNetEntry(raw: unknown): BrowserNetEntry | null {
  const row = asRecord(raw)
  if (row === null) return null
  const id = Math.trunc(finiteNumber(row.id, NaN))
  if (!Number.isFinite(id) || id <= 0) return null
  const url = clipUrl(String(row.url ?? ''))
  if (url === '') return null
  const methodRaw = String(row.method ?? 'GET').trim().toUpperCase()
  const method = METHOD_OK.test(methodRaw) ? methodRaw : clip(methodRaw, 8).text || 'GET'
  const resourceType = NET_TYPE_SET.has(String(row.resourceType))
    ? String(row.resourceType) as BrowserNetType
    : classifyBrowserResource(String(row.initiatorType ?? ''), url)
  return {
    id,
    method,
    url,
    resourceType,
    status: Math.max(0, Math.trunc(finiteNumber(row.status))),
    durationMs: Math.max(0, finiteNumber(row.durationMs)),
    size: Math.max(0, Math.trunc(finiteNumber(row.size))),
    pending: row.pending === true,
    failed: row.failed === true,
    startAt: Math.max(0, finiteNumber(row.startAt, Date.now())),
    requestHeaders: normalizeNetHeaders(row.requestHeaders),
    postData: normalizeNetPostData(row.postData),
    pageUrl: clipUrl(String(row.pageUrl ?? '')).trim() === '' ? undefined : clipUrl(String(row.pageUrl ?? '')),
  }
}

const NET_HEADER_MAX = 20
const NET_HEADER_VALUE_MAX = 300
const NET_POST_MAX = 2000

function normalizeNetHeaders(raw: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Array<[string, string]> = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue
    const name = String(item[0] ?? '').trim()
    const value = String(item[1] ?? '')
    if (name === '' || name.startsWith(':')) continue
    const clipped = clip(redactSecrets(value), NET_HEADER_VALUE_MAX).text
    out.push([clip(name, 64).text, clipped])
    if (out.length >= NET_HEADER_MAX) break
  }
  return out.length === 0 ? undefined : out
}

function normalizeNetPostData(raw: unknown): string | undefined {
  const text = String(raw ?? '')
  if (text === '') return undefined
  return redactSecrets(clip(text, NET_POST_MAX).text)
}

export function normalizeNetEntries(raw: unknown): BrowserNetEntry[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const out: BrowserNetEntry[] = []
  for (const item of list) {
    const entry = normalizeNetEntry(item)
    if (entry === null) continue
    out.push(entry)
    if (out.length >= BROWSER_NET_MAX) break
  }
  return out
}

export function emptyBrowserApp(): BrowserAppInfo {
  return { cookies: [], localStorage: [], sessionStorage: [], databases: [] }
}

export function normalizeAppInfo(raw: unknown): BrowserAppInfo {
  const row = asRecord(raw)
  if (row === null) return emptyBrowserApp()
  const databases: string[] = []
  if (Array.isArray(row.databases)) {
    for (const item of row.databases) {
      const name = clip(redactSecrets(String(item ?? '')), 200).text.trim()
      if (name === '') continue
      databases.push(name)
      if (databases.length >= BROWSER_STORE_MAX) break
    }
  }
  return {
    cookies: normalizeStoreRows(row.cookies),
    localStorage: normalizeStoreRows(row.localStorage),
    sessionStorage: normalizeStoreRows(row.sessionStorage),
    databases,
  }
}

export function normalizeCssDump(raw: unknown): { sheets: BrowserCssSheet[]; vars: BrowserCssVar[] } {
  const row = asRecord(raw)
  const sheets: BrowserCssSheet[] = []
  const vars: BrowserCssVar[] = []
  if (row === null) return { sheets, vars }
  if (Array.isArray(row.sheets)) {
    for (const item of row.sheets) {
      const sheet = asRecord(item)
      if (sheet === null) continue
      const ruleRaw = sheet.ruleCount
      const ruleCount = ruleRaw === null || ruleRaw === undefined ? null : Math.max(0, Math.trunc(finiteNumber(ruleRaw)))
      sheets.push({
        href: clipUrl(String(sheet.href ?? '')),
        title: clip(String(sheet.title ?? ''), 120).text,
        disabled: sheet.disabled === true,
        ruleCount,
        blocked: sheet.blocked === true,
      })
      if (sheets.length >= BROWSER_CSS_SHEETS_MAX) break
    }
  }
  if (Array.isArray(row.vars)) {
    for (const item of row.vars) {
      const cssVar = asRecord(item)
      if (cssVar === null) continue
      const name = clip(String(cssVar.name ?? ''), 120).text
      if (name === '') continue
      vars.push({
        name,
        value: clip(redactSecrets(String(cssVar.value ?? '')), 300).text,
      })
      if (vars.length >= BROWSER_CSS_VARS_MAX) break
    }
  }
  return { sheets, vars }
}

export function normalizeFileEntries(raw: unknown): BrowserFileEntry[] {
  if (!Array.isArray(raw)) return []
  const out: BrowserFileEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const row = asRecord(item)
    if (row === null) continue
    const url = clipUrl(String(row.url ?? ''))
    if (url === '' || seen.has(url)) continue
    seen.add(url)
    const kind = NET_TYPE_SET.has(String(row.kind))
      ? String(row.kind) as BrowserNetType
      : classifyBrowserResource(String(row.initiatorType ?? ''), url)
    out.push({
      url,
      kind,
      size: Math.max(0, Math.trunc(finiteNumber(row.size))),
      durationMs: Math.max(0, finiteNumber(row.durationMs)),
    })
    if (out.length >= BROWSER_FILES_MAX) break
  }
  return out
}

export function formatBrowserBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatBrowserDuration(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1000) return `${Math.round(n)} ms`
  return `${(n / 1000).toFixed(2)} s`
}
