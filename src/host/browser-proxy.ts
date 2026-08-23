import { BROWSER_INSPECT_SCRIPT } from '../shared/browser-inspect-script.ts'
import { normalizeBrowserUrl } from '../shared/browser-url.ts'
import { fail } from '../shared/errors.ts'
import { redactSecrets } from '../shared/redact.ts'
import type { GitFail } from '../shared/types.ts'

const FETCH_TIMEOUT_MS = 20_000
const MAX_HTML_BYTES = 2_000_000

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stripFramingHeaders(html: string): string {
  return html
    .replace(/<meta\b[^>]*http-equiv=["']?Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?X-Frame-Options["'][^>]*>/gi, '')
}

/** Inline so `<base href>` cannot rewrite `/git/browser/inspect.js` onto the target origin. */
export function inspectInlineTag(): string {
  const body = BROWSER_INSPECT_SCRIPT.replace(/<\/(script)/gi, '<\\/$1')
  return `<script data-dsh-inspect="1">${body}</script>`
}

export function injectBrowserHooks(html: string, pageUrl: string): string {
  const stripped = stripFramingHeaders(html)
  const base = `<base href="${escapeHtml(pageUrl)}">`
  const script = inspectInlineTag()
  if (/<head[\s>]/i.test(stripped)) {
    return stripped.replace(/<head([^>]*)>/i, `<head$1>${base}${script}`)
  }
  if (/<html[\s>]/i.test(stripped)) {
    return stripped.replace(/<html([^>]*)>/i, `<html$1><head>${base}${script}</head>`)
  }
  return `<!doctype html><head>${base}${script}</head>${stripped}`
}

export function browserFailPage(failBody: GitFail, pageUrl?: string): string {
  const urlLine = pageUrl === undefined || pageUrl === ''
    ? ''
    : `<p style="word-break:break-all;color:#666">${escapeHtml(redactSecrets(pageUrl))}</p>`
  const payload = JSON.stringify({
    source: 'dsh-workbench-browser',
    type: 'fail',
    message: failBody.messageZh,
    hint: failBody.hintZh,
  })
  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(failBody.messageZh)}</title>
<body style="font:14px/1.5 system-ui,sans-serif;padding:24px;color:#222;background:#fafafa">
  <h1 style="font-size:16px">${escapeHtml(failBody.messageZh)}</h1>
  ${urlLine}
  <p>${escapeHtml(failBody.hintZh)}</p>
  <script>parent.postMessage(${payload}, '*')</script>
</body>`
}

export function inspectScriptBody(): string {
  return BROWSER_INSPECT_SCRIPT
}

function headerOf(headers: Headers, name: string): string {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? ''
}

function isHtmlType(contentType: string): boolean {
  const lower = contentType.toLowerCase()
  return lower.includes('text/html') || lower.includes('application/xhtml')
}

function isTextLike(contentType: string): boolean {
  const lower = contentType.toLowerCase()
  return isHtmlType(contentType)
    || lower.startsWith('text/')
    || lower.includes('javascript')
    || lower.includes('json')
    || lower.includes('xml')
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? error.cause.message : ''
  const text = cause !== '' ? `${error.message}: ${cause}` : error.message
  return redactSecrets(text)
}

function requestHeaders(userAgent?: string): Record<string, string> {
  return {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(userAgent !== undefined && userAgent !== '' ? { 'user-agent': userAgent } : {}),
  }
}

async function fetchPage(
  url: string,
  userAgent: string | undefined,
  signal: AbortSignal,
): Promise<{ url: string; contentType: string; body: Buffer }> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal,
    headers: requestHeaders(userAgent),
  })
  const finalUrl = normalizeBrowserUrl(response.url) ?? url
  const contentType = headerOf(response.headers, 'content-type') || 'text/html; charset=utf-8'
  const body = Buffer.from(await response.arrayBuffer())
  return { url: finalUrl, contentType, body }
}

export async function fetchBrowserPage(
  rawUrl: string,
  userAgent?: string,
): Promise<{ ok: true; url: string; contentType: string; body: string } | { ok: false; fail: GitFail; url?: string }> {
  const url = normalizeBrowserUrl(rawUrl)
  if (url === null) return { ok: false, fail: fail('BROWSER_BAD_URL') }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, FETCH_TIMEOUT_MS)
  try {
    const page = await fetchPage(url, userAgent, controller.signal)
    const finalUrl = page.url
    if (page.body.byteLength > MAX_HTML_BYTES) {
      return { ok: false, fail: fail('BROWSER_TOO_LARGE'), url: finalUrl }
    }
    if (!isHtmlType(page.contentType) && !isTextLike(page.contentType) && page.body.byteLength > 0) {
      const wrapped = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(finalUrl)}</title></head><body><p>这个地址不是网页（${escapeHtml(page.contentType || '未知类型')}），没法点选元素。</p><p>请换成一个 http/https 网页地址。</p></body></html>`
      return { ok: true, url: finalUrl, contentType: 'text/html; charset=utf-8', body: wrapped }
    }
    return { ok: true, url: finalUrl, contentType: page.contentType, body: page.body.toString('utf8') }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.message === 'timeout')) {
      return { ok: false, fail: fail('BROWSER_TIMEOUT'), url }
    }
    return { ok: false, fail: fail('BROWSER_FAILED', errorDetail(error)), url }
  } finally {
    clearTimeout(timer)
  }
}
