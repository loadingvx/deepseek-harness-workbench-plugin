// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  copyText,
  downloadBlob,
  svgToHtml,
  svgViewSize,
} from '../src/client/workbench/svg-card-actions.ts'

const SIMPLE_SVG =
  '<svg width="120" height="60" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="100" height="40" rx="8" fill="#4c8dff"/><text x="60" y="38" font-size="16" fill="#ffffff" text-anchor="middle">Hello</text></svg>'

describe('svgToHtml', () => {
  it('wraps the svg in a standalone html document', () => {
    const html = svgToHtml(SIMPLE_SVG)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain(SIMPLE_SVG)
  })
})

describe('svgViewSize', () => {
  it('prefers viewBox when present', () => {
    const svg = '<svg viewBox="0 0 200 100" width="10" height="10"><rect/></svg>'
    expect(svgViewSize(svg)).toEqual({ width: 200, height: 100 })
  })

  it('falls back to width/height attributes', () => {
    expect(svgViewSize(SIMPLE_SVG)).toEqual({ width: 120, height: 60 })
  })

  it('returns defaults when no size info exists', () => {
    expect(svgViewSize('<svg><circle r="5"/></svg>')).toEqual({ width: 300, height: 150 })
  })

  it('does not throw on invalid svg', () => {
    expect(svgViewSize('not an svg at all')).toEqual({ width: 300, height: 150 })
  })
})

describe('downloadBlob', () => {
  it('creates an anchor, clicks it, and cleans up', () => {
    const click = vi.fn()
    const remove = vi.fn()
    const originalCreate = document.createElement.bind(document)
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.createElement('div'))
    const anchor = { href: '', download: '', click, remove } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return anchor as unknown as HTMLElement
      return originalCreate(tag)
    })
    try {
      downloadBlob(new Blob(['x'], { type: 'text/plain' }), 't.txt')
      expect(click).toHaveBeenCalledTimes(1)
      expect(anchor.download).toBe('t.txt')
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('copyText', () => {
  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined })
    // jsdom 未实现 execCommand：先补一个，再 spy 验证调用
    const exec = vi.fn().mockReturnValue(true)
    Object.assign(document, { execCommand: exec })
    await expect(copyText('hello')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })
})
