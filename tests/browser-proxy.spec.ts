import { describe, expect, it } from 'vitest'
import { browserFailPage, injectBrowserHooks, stripFramingHeaders } from '../src/host/browser-proxy.ts'
import { fail } from '../src/shared/errors.ts'
import { BROWSER_INSPECT_SCRIPT } from '../src/shared/browser-inspect-script.ts'
import { inspectScriptBody } from '../src/host/browser-proxy.ts'

describe('browser proxy HTML rewrite', () => {
  it('strips framing CSP and injects base + inspect script', () => {
    const html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
      <title>x</title>
    </head><body><div id="app">hi</div></body></html>`
    expect(stripFramingHeaders(html)).not.toContain('Content-Security-Policy')
    const out = injectBrowserHooks(html, 'https://example.com/app')
    expect(out).toContain('<base href="https://example.com/app">')
    expect(out).toContain('data-dsh-inspect="1"')
    expect(out).toContain('window.__DSH_BROWSER__')
    expect(out).not.toContain('src="/git/browser/inspect.js"')
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('data-dsh-inspect="1"'))
  })

  it('still injects when the page has no head or body', () => {
    const out = injectBrowserHooks('<p>hello</p>', 'http://127.0.0.1:5173/')
    expect(out).toContain('<base href="http://127.0.0.1:5173/">')
    expect(out).toContain('data-dsh-inspect="1"')
  })

  it('serves the inspect script body used by the iframe', () => {
    expect(inspectScriptBody()).toBe(BROWSER_INSPECT_SCRIPT)
  })

  it('error page tells the parent why it failed, with the URL redacted', () => {
    const page = browserFailPage(fail('BROWSER_FAILED', 'token=ghp_abcdefghijklmnopqrstuv'), 'https://octocat:ghp_abcdefghijklmnopqrstuv@github.com/acme/app')
    expect(page).toContain('网页没有加载成功')
    expect(page).toContain('本机网络')
    expect(page).toContain("type\":\"fail\"")
    expect(page).not.toContain('ghp_abcdefghijklmnopqrstuv')
    expect(page).toContain('ghp***uv')
  })
})
