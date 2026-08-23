import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl, browserUrlHost, browserViewSrc, readBrowserViewTarget, isWorkbenchSelfUrl, workbenchHrefFromHost } from '../src/shared/browser-url.ts'

describe('normalizeBrowserUrl', () => {
  it('accepts http(s) and adds https when the scheme is missing', () => {
    expect(normalizeBrowserUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeBrowserUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/')
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
  })

  it('rejects non-web schemes and empty input', () => {
    expect(normalizeBrowserUrl('')).toBeNull()
    expect(normalizeBrowserUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeBrowserUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeBrowserUrl('data:text/html,hi')).toBeNull()
  })
})

describe('isWorkbenchSelfUrl', () => {
  const workbench = workbenchHrefFromHost('127.0.0.1:3080')

  it('treats localhost / 127.0.0.1 / ::1 on the same port as the workbench itself', () => {
    expect(isWorkbenchSelfUrl('http://127.0.0.1:3080/', workbench)).toBe(true)
    expect(isWorkbenchSelfUrl('http://localhost:3080/chat', workbench)).toBe(true)
    expect(isWorkbenchSelfUrl('http://[::1]:3080/', workbench)).toBe(true)
  })

  it('allows other local ports and remote sites', () => {
    expect(isWorkbenchSelfUrl('http://127.0.0.1:5173/', workbench)).toBe(false)
    expect(isWorkbenchSelfUrl('http://localhost:3000', workbench)).toBe(false)
    expect(isWorkbenchSelfUrl('https://example.com/', workbench)).toBe(false)
  })
})

describe('browserViewSrc', () => {
  it('puts the page URL in the proxy query', () => {
    expect(browserViewSrc('https://example.com/x')).toBe('/git/browser/view?u=https%3A%2F%2Fexample.com%2Fx')
    expect(readBrowserViewTarget('https://app.local/git/browser/view?u=https%3A%2F%2Fexample.com%2F')).toBe('https://example.com/')
    expect(browserUrlHost('https://example.com:8443/a')).toBe('example.com:8443')
  })
})
