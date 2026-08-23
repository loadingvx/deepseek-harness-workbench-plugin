import { describe, expect, it } from 'vitest'
import { BROWSER_DUMP_EVAL } from '../src/shared/browser-dump-eval.ts'
import {
  classifyBrowserResource,
  formatBrowserBytes,
  formatBrowserDuration,
  normalizeAppInfo,
  normalizeCssDump,
  normalizeFileEntries,
  normalizeNetEntries,
  parseCookieString,
} from '../src/shared/browser-devtools.ts'

describe('classifyBrowserResource', () => {
  it('maps initiator types and file extensions', () => {
    expect(classifyBrowserResource('xmlhttprequest', 'https://x.test/a')).toBe('xhr')
    expect(classifyBrowserResource('fetch', 'https://x.test/a')).toBe('fetch')
    expect(classifyBrowserResource('script', 'https://x.test/a')).toBe('script')
    expect(classifyBrowserResource('link', 'https://x.test/a.css')).toBe('stylesheet')
    expect(classifyBrowserResource('', 'https://x.test/app.js')).toBe('script')
    expect(classifyBrowserResource('', 'https://x.test/hero.webp')).toBe('image')
    expect(classifyBrowserResource('', 'https://x.test/font.woff2')).toBe('font')
    expect(classifyBrowserResource('', 'https://x.test/unknown')).toBe('other')
  })
})

describe('normalizeNetEntries', () => {
  it('drops junk, caps fields, and redacts secrets in URLs', () => {
    const rows = normalizeNetEntries([
      { id: 1, method: 'post', url: 'https://x.test/api?token=ghp_abcdefghijklmnopqrstuv', resourceType: 'fetch', status: 201, durationMs: 12.2, size: 40 },
      { id: 0, url: 'https://x.test/bad' },
      { method: 'GET', url: 'https://x.test/missing-id' },
      'nope',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.method).toBe('POST')
    expect(rows[0]?.url).toContain('token=')
    expect(rows[0]?.url).toContain('***')
    expect(rows[0]?.url).not.toContain('ghp_abcdefghijklmnopqrstuv')
    expect(rows[0]?.pending).toBe(false)
  })
})

describe('normalizeAppInfo', () => {
  it('parses cookies and redacts storage values', () => {
    const cookies = parseCookieString(' sid=abc; token=ghp_abcdefghijklmnopqrstuv ')
    expect(cookies[0]?.name).toBe('sid')
    expect(cookies[1]?.value).toContain('***')
    expect(cookies[1]?.value).not.toContain('ghp_abcdefghijklmnopqrstuv')

    const app = normalizeAppInfo({
      cookies: [{ name: 'a', value: '1' }],
      localStorage: [{ name: 'k', value: 'secret token=ghp_abcdefghijklmnopqrstuv' }],
      sessionStorage: 'nope',
      databases: ['app-db', '', 1],
    })
    expect(app.cookies).toHaveLength(1)
    expect(app.localStorage[0]?.value).toContain('***')
    expect(app.sessionStorage).toEqual([])
    expect(app.databases).toEqual(['app-db', '1'])
  })
})

describe('normalizeCssDump and files', () => {
  it('keeps stylesheet rows and unique files', () => {
    const css = normalizeCssDump({
      sheets: [{ href: 'https://x.test/a.css', ruleCount: 3, blocked: false }],
      vars: [{ name: '--bg', value: '#fff' }],
    })
    expect(css.sheets).toEqual([{ href: 'https://x.test/a.css', title: '', disabled: false, ruleCount: 3, blocked: false }])
    expect(css.vars).toEqual([{ name: '--bg', value: '#fff' }])

    const files = normalizeFileEntries([
      { url: 'https://x.test/app.js', kind: 'script', size: 10, durationMs: 2 },
      { url: 'https://x.test/app.js', kind: 'script', size: 99 },
      { url: '' },
    ])
    expect(files).toHaveLength(1)
    expect(files[0]?.size).toBe(10)
  })
})

describe('format helpers', () => {
  it('hides empty sizes and durations', () => {
    expect(formatBrowserBytes(0)).toBe('')
    expect(formatBrowserBytes(1500)).toContain('KB')
    expect(formatBrowserDuration(0)).toBe('')
    expect(formatBrowserDuration(12)).toBe('12 ms')
  })
})

describe('dump eval payload', () => {
  it('posts files, css, app, and net from inside the page', () => {
    expect(() => { new Function(BROWSER_DUMP_EVAL) }).not.toThrow()
    expect(BROWSER_DUMP_EVAL).toContain("type: 'files'")
    expect(BROWSER_DUMP_EVAL).toContain("type: 'css'")
    expect(BROWSER_DUMP_EVAL).toContain("type: 'app'")
    expect(BROWSER_DUMP_EVAL).toContain("type: 'net'")
    expect(BROWSER_DUMP_EVAL).toContain('performance.getEntriesByType')
  })
})
