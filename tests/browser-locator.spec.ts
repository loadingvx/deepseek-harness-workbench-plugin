// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { elementCssPath, elementJsPath, elementXPath } from '../src/shared/browser-locator.ts'
import { BROWSER_INSPECT_SCRIPT, BROWSER_MSG_SOURCE } from '../src/shared/browser-inspect-script.ts'

describe('element locators', () => {
  it('builds xpath, css, and jspath for a nested node', () => {
    document.body.innerHTML = '<main><div class="wrap"><span id="n">hi</span></div></main>'
    const span = document.querySelector('#n')!
    expect(elementXPath(span)).toBe('/html[1]/body[1]/main[1]/div[1]/span[1]')
    expect(elementCssPath(span)).toBe('#n')
    expect(elementJsPath(span)).toBe('document.querySelector("#n")')
  })

  it('uses nth-of-type when siblings share a tag', () => {
    document.body.innerHTML = '<div><p>a</p><p class="b">b</p></div>'
    const second = document.querySelector('p.b')!
    expect(elementXPath(second)).toBe('/html[1]/body[1]/div[1]/p[2]')
    expect(elementCssPath(second)).toContain('nth-of-type(2)')
  })
})

describe('inspect script payload', () => {
  it('captures outerHTML and locator fields for the agent', () => {
    expect(BROWSER_INSPECT_SCRIPT).toContain('outerHTML')
    expect(BROWSER_INSPECT_SCRIPT).toContain('xpathOf')
    expect(BROWSER_INSPECT_SCRIPT).toContain('jsPathOf')
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'pick'")
    expect(BROWSER_INSPECT_SCRIPT).toContain(BROWSER_MSG_SOURCE)
    expect(BROWSER_INSPECT_SCRIPT).toContain('htmlTruncated')
    expect(BROWSER_INSPECT_SCRIPT).toContain('data-dsh-inspect-overlay')
    expect(BROWSER_INSPECT_SCRIPT).toContain('2147483647')
    expect(BROWSER_INSPECT_SCRIPT).toContain("data.type === 'eval'")
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'eval-result'")
    expect(BROWSER_INSPECT_SCRIPT).toContain('unhandledrejection')
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'net'")
    expect(BROWSER_INSPECT_SCRIPT).toContain('PerformanceObserver')
    expect(BROWSER_INSPECT_SCRIPT).toContain('XMLHttpRequest.prototype')
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'app'")
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'css'")
    expect(BROWSER_INSPECT_SCRIPT).toContain("type: 'files'")
    expect(BROWSER_INSPECT_SCRIPT).toContain("data.type === 'probe'")
  })
})
