import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { sendVendorAsset } from '../src/host/vendor-static.ts'

class FakeReq extends EventEmitter {
  headers: Record<string, string | undefined>
  constructor(headers: Record<string, string | undefined> = {}) {
    super()
    this.headers = headers
  }
}

class FakeRes extends EventEmitter {
  statusCode = 0
  headers: Record<string, string> = {}
  body: Buffer = Buffer.alloc(0)
  setHeader(name: string, value: string | number): void {
    this.headers[name.toLowerCase()] = String(value)
  }
  end(chunk?: string | Buffer): void {
    if (chunk !== undefined) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.emit('finish')
  }
}

describe('sendVendorAsset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vendor-'))
  const js = 'export default { initialize() {}, render() { return Promise.resolve({ svg: "<svg></svg>" }) } }\n'
  writeFileSync(join(dir, 'mermaid.js'), js)

  it('serves mermaid.js with gzip when requested', async () => {
    const req = new FakeReq({ 'accept-encoding': 'gzip, deflate' }) as unknown as IncomingMessage
    const res = new FakeRes() as unknown as ServerResponse & FakeRes
    const served = await sendVendorAsset(req, res, '/git/vendor/mermaid.js', dir)
    expect(served).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['content-type']).toContain('javascript')
    expect(gunzipSync(res.body).toString()).toBe(js)
  })

  it('returns 304 when If-None-Match matches', async () => {
    const firstReq = new FakeReq() as unknown as IncomingMessage
    const firstRes = new FakeRes() as unknown as ServerResponse & FakeRes
    await sendVendorAsset(firstReq, firstRes, '/git/vendor/mermaid.js', dir)
    const etag = firstRes.headers.etag
    expect(etag).toMatch(/^"/)

    const req = new FakeReq({ 'if-none-match': etag }) as unknown as IncomingMessage
    const res = new FakeRes() as unknown as ServerResponse & FakeRes
    await sendVendorAsset(req, res, '/git/vendor/mermaid.js', dir)
    expect(res.statusCode).toBe(304)
    expect(res.body.length).toBe(0)
  })

  it('returns false for non-vendor paths', async () => {
    const req = new FakeReq() as unknown as IncomingMessage
    const res = new FakeRes() as unknown as ServerResponse & FakeRes
    expect(await sendVendorAsset(req, res, '/git/status', dir)).toBe(false)
  })
})
