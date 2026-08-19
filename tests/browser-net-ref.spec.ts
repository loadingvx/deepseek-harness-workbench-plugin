import { describe, expect, it } from 'vitest'
import {
  buildCurlCommand,
  buildNetReference,
  clipboardNetRef,
  encodeNetRef,
  NET_REF_SOURCE,
  netRefChipLabel,
  netRefLabelOf,
  normalizeNetRefSnapshot,
  parseNetRef,
  serializeNetRef,
  serializeNetRefRef,
} from '../src/shared/browser-net-ref.ts'

describe('net ref codec', () => {
  it('normalizes method and keeps url', () => {
    expect(normalizeNetRefSnapshot({ method: 'post', url: ' https://a.com/x ' })).toEqual({
      method: 'POST',
      url: 'https://a.com/x',
    })
    expect(normalizeNetRefSnapshot({ method: '', url: '' })).toBeNull()
    expect(normalizeNetRefSnapshot({ method: 'CUSTOM-LONG-METHOD-NAME', url: 'https://a.com' })).toEqual({
      method: 'GET',
      url: 'https://a.com',
    })
  })

  it('round-trips encode/parse and serializes to the curl command for the model', () => {
    const snapshot = { method: 'POST', url: 'https://example.com/api?q=1' }
    const ref = encodeNetRef(snapshot)
    expect(parseNetRef(ref)).toEqual(snapshot)
    expect(serializeNetRef(snapshot)).toBe("curl -X POST 'https://example.com/api?q=1'")
    expect(serializeNetRefRef(ref)).toBe("curl -X POST 'https://example.com/api?q=1'")
    expect(clipboardNetRef(ref)).toBe("curl -X POST 'https://example.com/api?q=1'")
    expect(serializeNetRefRef('garbage')).toContain('已过期')
  })

  it('builds a reference whose label is the clamped curl command', () => {
    const built = buildNetReference({ method: 'GET', url: 'https://example.com/app.js' })
    expect(built?.source).toBe(NET_REF_SOURCE)
    expect(built?.label).toBe("curl 'https://example.com/app.js'")
    const again = buildNetReference(
      { method: 'GET', url: 'https://example.com/app.js' },
      [{ ref: built!.ref, label: "curl 'https://example.com/app.js'" }],
    )
    expect(again?.label).toBe("curl 'https://example.com/app.js' · 2")
  })

  it('labels are the curl command and clamp length', () => {
    expect(netRefLabelOf('GET', 'https://a.com/x')).toBe("curl 'https://a.com/x'")
    expect(netRefLabelOf('POST', 'https://a.com/x')).toBe("curl -X POST 'https://a.com/x'")
    expect(netRefChipLabel('GET', 'https://a.com/x', [])).toBe("curl 'https://a.com/x'")
    expect(netRefLabelOf('GET', 'https://a.com/' + 'y'.repeat(200)).endsWith('…')).toBe(true)
  })
})

describe('buildCurlCommand', () => {
  it('emits a GET without -X and quotes per platform', () => {
    expect(buildCurlCommand('GET', 'https://a.com/x', 'linux')).toBe("curl 'https://a.com/x'")
    expect(buildCurlCommand('get', 'https://a.com/x', 'windows')).toBe('curl.exe "https://a.com/x"')
  })

  it('emits -X for non-GET methods', () => {
    expect(buildCurlCommand('POST', 'https://a.com/api', 'linux')).toBe("curl -X POST 'https://a.com/api'")
    expect(buildCurlCommand('DELETE', 'https://a.com/api/1', 'windows')).toBe('curl.exe -X DELETE "https://a.com/api/1"')
  })

  it('escapes single quotes for sh and double quotes for cmd', () => {
    expect(buildCurlCommand('GET', "https://a.com/it's", 'linux')).toBe("curl 'https://a.com/it'\\''s'")
    expect(buildCurlCommand('GET', 'https://a.com/x"y', 'windows')).toBe('curl.exe "https://a.com/x""y"')
    expect(buildCurlCommand('GET', 'https://a.com/%25', 'windows')).toBe('curl.exe "https://a.com/%%25"')
  })

  it('emits headers and body when present', () => {
    const extra = {
      headers: [['Content-Type', 'application/json'], [':authority', 'skip'], ['Authorization', 'Bearer abc']] as Array<[string, string]>,
      postData: '{"a":1}',
    }
    expect(buildCurlCommand('POST', 'https://a.com/api', 'linux', extra)).toBe(
      "curl -X POST 'https://a.com/api' -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' --data-raw '{\"a\":1}'",
    )
    // Windows cmd: embedded quotes inside a double-quoted argument are doubled.
    expect(buildCurlCommand('POST', 'https://a.com/api', 'windows', extra)).toBe(
      'curl.exe -X POST "https://a.com/api" -H "Content-Type: application/json" -H "Authorization: Bearer abc" --data-raw "{""a"":1}"'.replace('{ ""a"":1}', '{ ""a"":1}'),
    )
    // cmd escaping: JSON body quotes double up inside the double-quoted argument.
    expect(buildCurlCommand('POST', 'https://a.com/api', 'windows', { headers: [], postData: '{"a":1}' })).toBe(
      'curl.exe -X POST "https://a.com/api" --data-raw "{""a"":1}"'.replace('{ ""a"":1}', '{ ""a"":1}'),
    )
  })

  it('serializes the full curl with the source page route comment', () => {
    expect(serializeNetRef({ method: 'POST', url: 'https://a.com/api', postData: 'x=1', pageUrl: 'https://a.com/form' })).toBe(
      "curl -X POST 'https://a.com/api' --data-raw 'x=1'\n# 来源页面: https://a.com/form",
    )
    expect(serializeNetRef({ method: 'GET', url: 'https://a.com/x' })).toBe("curl 'https://a.com/x'")
  })
})
