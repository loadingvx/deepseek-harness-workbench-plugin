/** Address-bar URL: only http(s). Secrets stay in the href for fetch; UI must redact. */

const MAX_URL_LEN = 4096
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > MAX_URL_LEN) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  return url.href
}

export function browserUrlHost(href: string): string {
  try {
    const host = new URL(href).host
    return host === '' ? href : host
  } catch {
    return href
  }
}

export function browserViewSrc(pageUrl: string): string {
  return `/git/browser/view?u=${encodeURIComponent(pageUrl)}`
}

export function readBrowserViewTarget(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl, 'http://127.0.0.1')
    return normalizeBrowserUrl(url.searchParams.get('u') ?? '')
  } catch {
    return null
  }
}

function canonicalHost(hostname: string): string {
  const host = hostname.toLowerCase()
  return LOOPBACK.has(host) ? 'loopback' : host
}

function originKey(url: URL): string {
  const port = url.port !== '' ? url.port : (url.protocol === 'https:' ? '443' : '80')
  return `${url.protocol}//${canonicalHost(url.hostname)}:${port}`
}

export function workbenchHrefFromHost(hostHeader: string, protocol: 'http:' | 'https:' = 'http:'): string {
  const host = hostHeader.trim() || '127.0.0.1'
  return `${protocol}//${host}/`
}

/**
 * True when the address bar points at this same workbench origin
 * (127.0.0.1 / localhost / ::1 on the same port). Opening that inside the
 * embedded browser nests the app in itself and can stall the proxy fetch.
 */
export function isWorkbenchSelfUrl(targetHref: string, workbenchHref: string): boolean {
  const target = normalizeBrowserUrl(targetHref)
  const self = normalizeBrowserUrl(workbenchHref)
  if (target === null || self === null) return false
  try {
    return originKey(new URL(target)) === originKey(new URL(self))
  } catch {
    return false
  }
}
