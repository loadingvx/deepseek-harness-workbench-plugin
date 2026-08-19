import { describe, expect, it } from 'vitest'
import {
  BROWSER_EL_SOURCE,
  buildBrowserElReference,
  browserElChipLabel,
  parseBrowserEl,
  serializeBrowserEl,
  serializeBrowserElRef,
  type BrowserElSnapshot,
} from '../src/shared/browser-el.ts'

function snap(over: Partial<BrowserElSnapshot> = {}): BrowserElSnapshot {
  return {
    tag: 'div',
    id: 'hero',
    className: 'hero card',
    name: '',
    href: '',
    type: '',
    role: '',
    testId: '',
    xpath: '/html[1]/body[1]/div[1]',
    cssPath: '#hero',
    jsPath: 'document.querySelector("#hero")',
    text: '欢迎',
    html: '<div id="hero" class="hero card">欢迎</div>',
    htmlTruncated: false,
    url: 'https://example.com/app',
    title: '示例',
    ...over,
  }
}

describe('browser element chips', () => {
  it('shows only the outer tag on the chip', () => {
    expect(browserElChipLabel('DIV', [])).toBe('div')
    expect(browserElChipLabel('span', [{ label: 'span' }])).toBe('span · 2')
    expect(buildBrowserElReference(snap())?.label).toBe('div')
    expect(buildBrowserElReference(snap(), [{ label: 'div' }])?.label).toBe('div · 2')
    expect(buildBrowserElReference(snap())?.source).toBe(BROWSER_EL_SOURCE)
  })

  it('keeps the original outer HTML in the model payload', () => {
    const html = '<section data-testid="pay"><button type="submit">提交</button></section>'
    const packed = snap({ tag: 'section', html, xpath: '/html[1]/body[1]/section[1]', cssPath: '[data-testid="pay"]' })
    const text = serializeBrowserEl(packed)
    expect(text).toContain(html)
    expect(text).toContain('XPath: /html[1]/body[1]/section[1]')
    expect(text).toContain('JSPath: document.querySelector("#hero")')
    expect(text).toContain('【浏览器元素】')
    const built = buildBrowserElReference(packed)!
    expect(serializeBrowserElRef(built.ref)).toContain(html)
    expect(parseBrowserEl(built.ref)?.html).toBe(html)
  })

  it('does not drop HTML when the markup is long; it truncates and flags it', () => {
    const html = `<div>${'x'.repeat(60_000)}</div>`
    const text = serializeBrowserEl(snap({ html }))
    expect(text).toContain('<div>')
    expect(text).toContain('HTML:')
    expect(text).toContain('已截断')
    expect(text.length).toBeLessThan(html.length)
  })
})
