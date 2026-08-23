/**
 * Official composer chip source for DevTools network requests.
 * Draft holds U+FFFC; InputBar paints the chip; submit runs codec.serialize
 * which expands to the Linux-style curl command for the model.
 */
export const NET_REF_SOURCE = 'workbench-net'

export const NET_REF_TRIGGER = '@' as const

/** Network-row drag payload. Custom type is authoritative; text/plain is the Firefox fallback. */
export const NET_REF_DRAG_TYPE = 'application/x-dsh-net-ref'

export interface NetRefSnapshot {
  readonly method: string
  readonly url: string
  /** Request headers (name/value pairs) captured by the net hooks. */
  readonly headers?: ReadonlyArray<readonly [string, string]>
  /** Request body captured by the net hooks (best-effort). */
  readonly postData?: string
  /** The page route (address-bar URL) the request originated from. */
  readonly pageUrl?: string
}

export interface NetRefOccurrence {
  readonly ref?: string
  readonly label?: string
}

const PREFIX = 'n1:'
const NET_REF_LABEL_MAX = 64

export function normalizeNetRefMethod(method: string): string {
  const m = String(method ?? '').trim().toUpperCase()
  return /^[A-Z]{1,12}$/.test(m) ? m : 'GET'
}

export function clipNetRefUrl(url: string): string {
  const u = String(url ?? '').trim()
  return u.length <= 1500 ? u : u.slice(0, 1500)
}

export function normalizeNetRefSnapshot(raw: unknown): NetRefSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const url = clipNetRefUrl(String(rec.url ?? ''))
  if (url === '') return null
  const headers = normalizeNetRefHeaders(rec.headers)
  const postData = normalizeNetRefPostData(rec.postData)
  const pageUrl = clipNetRefUrl(String(rec.pageUrl ?? ''))
  return {
    method: normalizeNetRefMethod(String(rec.method ?? 'GET')),
    url,
    ...(headers !== undefined ? { headers } : {}),
    ...(postData !== undefined ? { postData } : {}),
    ...(pageUrl !== '' ? { pageUrl } : {}),
  }
}

function normalizeNetRefHeaders(raw: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Array<[string, string]> = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue
    const name = String(item[0] ?? '').trim()
    const value = String(item[1] ?? '')
    if (name === '' || name.startsWith(':')) continue
    out.push([name.slice(0, 64), value.slice(0, 300)])
    if (out.length >= 20) break
  }
  return out.length === 0 ? undefined : out
}

function normalizeNetRefPostData(raw: unknown): string | undefined {
  const text = String(raw ?? '')
  if (text === '') return undefined
  return text.slice(0, 2000)
}

/** Short human label: the Linux-style curl command, clamped. */
export function netRefLabelOf(method: string, url: string): string {
  let label = buildCurlCommand(method, url, 'linux')
  if (label.length > NET_REF_LABEL_MAX) label = label.slice(0, NET_REF_LABEL_MAX - 1) + '…'
  return label
}

/** Chip label. Same command already in the draft becomes `curl … · 2`. */
export function netRefChipLabel(method: string, url: string, existing: ReadonlyArray<NetRefOccurrence>): string {
  const name = netRefLabelOf(method, url)
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

export function encodeNetRef(snapshot: NetRefSnapshot): string {
  return PREFIX + encodeURIComponent(JSON.stringify(snapshot))
}

export function parseNetRef(ref: string): NetRefSnapshot | null {
  if (!ref.startsWith(PREFIX)) return null
  try {
    const raw = JSON.parse(decodeURIComponent(ref.slice(PREFIX.length))) as unknown
    return normalizeNetRefSnapshot(raw)
  } catch {
    return null
  }
}

/** Model form: the full Linux-style curl command, with the source page route as a shell comment. */
export function serializeNetRef(snapshot: NetRefSnapshot): string {
  const curl = buildCurlCommand(snapshot.method, snapshot.url, 'linux', snapshot)
  const page = clipNetRefUrl(String(snapshot.pageUrl ?? ''))
  if (page !== '' && page !== snapshot.url) {
    return `${curl}\n# 来源页面: ${page}`
  }
  return curl
}

export function serializeNetRefRef(ref: string): string {
  const snapshot = parseNetRef(ref)
  if (snapshot === null) {
    return '【网络请求】内容已过期，请在 DevTools 网络面板重新操作。'
  }
  return serializeNetRef(snapshot)
}

export function clipboardNetRef(ref: string): string {
  const snapshot = parseNetRef(ref)
  return snapshot === null ? '' : serializeNetRef(snapshot)
}

export function buildNetReference(
  snapshot: NetRefSnapshot,
  existing: ReadonlyArray<NetRefOccurrence> = [],
): { source: typeof NET_REF_SOURCE; ref: string; label: string; clipboardText: string } | null {
  const normalized = normalizeNetRefSnapshot(snapshot)
  if (normalized === null) return null
  const ref = encodeNetRef(normalized)
  return {
    source: NET_REF_SOURCE,
    ref,
    label: netRefChipLabel(normalized.method, normalized.url, existing),
    clipboardText: clipboardNetRef(ref),
  }
}

export type CurlTarget = 'linux' | 'windows'

/** POSIX sh single quote: wrap and escape embedded quotes as '''. */
function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/** cmd.exe double quote: double embedded quotes, double % to avoid variable expansion. */
function cmdQuote(value: string): string {
  return '"' + value.replace(/%/g, '%%').replace(/"/g, '""') + '"'
}

/**
 * Copy-as-curl. Linux uses single quotes; Windows uses the cmd.exe quoting
 * rules and the `curl.exe` binary name. When headers / a body are present
 * they are emitted as `-H 'Name: value'` / `--data-raw '...'`.
 */
export function buildCurlCommand(
  method: string,
  url: string,
  target: CurlTarget,
  extra?: Pick<NetRefSnapshot, 'headers' | 'postData'>,
): string {
  const m = normalizeNetRefMethod(method)
  const u = clipNetRefUrl(url)
  const curl = target === 'windows' ? 'curl.exe' : 'curl'
  const quote = target === 'windows' ? cmdQuote : shQuote
  const headers = extra?.headers ?? []
  const postData = extra?.postData
  const hasBody = postData !== undefined && postData !== ''
  const parts: string[] = []
  parts.push(`${curl}${m === 'GET' && !hasBody ? '' : ` -X ${m}`}`)
  parts.push(quote(u))
  for (const pair of headers) {
    const name = String(pair[0] ?? '').trim()
    if (name === '' || name.startsWith(':')) continue
    const value = String(pair[1] ?? '')
    parts.push(`-H ${quote(`${name}: ${value}`)}`)
  }
  if (hasBody) parts.push(`--data-raw ${quote(postData)}`)
  return parts.join(' ')
}
