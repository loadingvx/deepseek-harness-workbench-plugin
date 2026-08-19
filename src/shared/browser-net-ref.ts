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
  return { method: normalizeNetRefMethod(String(rec.method ?? 'GET')), url }
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

/** Model form: the Linux-style curl command. */
export function serializeNetRef(snapshot: NetRefSnapshot): string {
  return buildCurlCommand(snapshot.method, snapshot.url, 'linux')
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
 * Copy-as-curl. Only method + url are recorded by the net hooks, so the
 * command is minimal (no headers/body). Linux uses single quotes; Windows
 * uses the cmd.exe quoting rules and the `curl.exe` binary name.
 */
export function buildCurlCommand(method: string, url: string, target: CurlTarget): string {
  const m = normalizeNetRefMethod(method)
  const u = clipNetRefUrl(url)
  const curl = target === 'windows' ? 'curl.exe' : 'curl'
  const quoted = target === 'windows' ? cmdQuote(u) : shQuote(u)
  const flag = m === 'GET' ? '' : ` -X ${m}`
  return `${curl}${flag} ${quoted}`
}
