/**
 * Tests for the Files-tab transfer routes (upload / download / folder zip).
 * 1. The web server's connection gate runs before any filesystem work.
 * 2. Uploads commit atomically and never overwrite; an interrupted stream leaves no temp file.
 * 3. Paths are jailed to the session workspace; symlinks cannot escape it.
 * 4. Folder downloads are valid zips: correct CRCs, UTF-8 names, directory entries, symlinks skipped.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { registerFileTransferHttp } from '../src/host/file-transfer/http.ts'
import { uploadFile } from '../src/host/file-transfer/upload.ts'

interface ZipEntry {
  name: string
  method: number
  crc: number
  comp: number
  uncomp: number
  localOff: number
  data: Buffer
}

function parseZip(buf: Buffer): ZipEntry[] {
  const eocd = buf.length - 22
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50)
  const count = buf.readUInt16LE(eocd + 8)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  expect(cdOff + cdSize).toBe(eocd)
  const entries: ZipEntry[] = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50)
    const nameLen = buf.readUInt16LE(p + 28)
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      comp: buf.readUInt32LE(p + 20),
      uncomp: buf.readUInt32LE(p + 24),
      localOff: buf.readUInt32LE(p + 42),
      data: Buffer.alloc(0),
    })
    p += 46 + nameLen
  }
  for (const entry of entries) {
    expect(buf.readUInt32LE(entry.localOff)).toBe(0x04034b50)
    const nameLen = buf.readUInt16LE(entry.localOff + 26)
    const extraLen = buf.readUInt16LE(entry.localOff + 28)
    expect(buf.toString('utf8', entry.localOff + 30, entry.localOff + 30 + nameLen)).toBe(entry.name)
    const start = entry.localOff + 30 + nameLen + extraLen
    const raw = buf.subarray(start, start + entry.comp)
    entry.data = entry.method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    expect(entry.data.length).toBe(entry.uncomp)
    expect(crc32(entry.data)).toBe(entry.crc)
  }
  return entries
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const rel = prefix === '' ? item.name : `${prefix}/${item.name}`
      if (item.isDirectory()) await walk(join(current, item.name), rel)
      else out.push(rel)
    }
  }
  await walk(dir, '')
  return out.sort()
}

interface Harness {
  base: string
  root: string
  close: () => Promise<void>
}

async function serve(options: { authenticated?: boolean; cwd?: string }): Promise<Harness> {
  const root = await tempDir('dsh-transfer-root-')
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>()
  const ctx = {
    webServer: {
      register: (route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    get: (name: string): unknown => {
      if (name === 'connection') return { requestRejection: (req: IncomingMessage) => (req.headers['x-test-auth'] === 'ok' ? undefined : 401) }
      if (name === 'sessions') return { get: (id: string) => (id === 'live' ? { header: { cwd: options.cwd ?? root } } : undefined) }
      return undefined
    },
  }
  void options.authenticated
  registerFileTransferHttp(ctx as unknown as Context)
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    void handler(req, res)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    base: `http://127.0.0.1:${address.port}/git/fs/`,
    root,
    close: async () => {
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
      await rm(root, { recursive: true, force: true })
    },
  }
}

const AUTH = { 'x-test-auth': 'ok' }

describe('file transfer routes', () => {
  it('registers four exact routes and refuses to run without the connection gate', async () => {
    const harness = await serve({})
    try {
      const res = await fetch(`${harness.base}upload?sessionId=live&path=a.txt`, { method: 'POST', body: 'x' })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.code).toBe('AUTH_REQUIRED')
      expect((await fetch(`${harness.base}download?sessionId=live&path=a.txt`)).status).toBe(401)
      expect((await fetch(`${harness.base}download-dir?sessionId=live&path=`)).status).toBe(401)
    } finally {
      await harness.close()
    }
    const captured: Array<(req: IncomingMessage, res: ServerResponse) => void | Promise<void>> = []
    const noGate = {
      webServer: {
        register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => {
          captured.push(route.handler)
          return () => {}
        },
      },
      get: () => undefined,
    } as unknown as Context
    expect(registerFileTransferHttp(noGate)).toBeTypeOf('function')
    expect(captured.length).toBe(4)
    const status = await new Promise<number>((resolve) => {
      const res = {
        statusCode: 0,
        headersSent: false,
        setHeader: () => {},
        end: () => resolve(res.statusCode),
      } as unknown as ServerResponse
      void captured[0]({ method: 'POST', url: '/git/fs/upload', headers: {} } as unknown as IncomingMessage, res)
    })
    expect(status).toBe(401)
  })

  it('uploads and downloads binary + unicode names, and never overwrites', async () => {
    const harness = await serve({})
    try {
      const bin = Buffer.from([0, 255, 13, 10, 128, 42])
      const up = await fetch(`${harness.base}upload?sessionId=live&path=${encodeURIComponent('子目录/中文 文件.bin')}`, {
        method: 'POST', headers: { ...AUTH, 'content-type': 'application/octet-stream' }, body: bin,
      })
      expect(up.status).toBe(200)
      expect((await up.json()).value).toEqual({ path: '子目录/中文 文件.bin', size: bin.length })
      const down = await fetch(`${harness.base}download?sessionId=live&path=${encodeURIComponent('子目录/中文 文件.bin')}`, { headers: AUTH })
      expect(down.status).toBe(200)
      expect(down.headers.get('content-type')).toBe('application/octet-stream')
      expect(down.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('中文 文件.bin')}`)
      expect(Buffer.from(await down.arrayBuffer())).toEqual(bin)

      const again = await fetch(`${harness.base}upload?sessionId=live&path=${encodeURIComponent('子目录/中文 文件.bin')}`, {
        method: 'POST', headers: AUTH, body: 'other',
      })
      expect(again.status).toBe(409)
      expect((await again.json()).code).toBe('FS_EXISTS')
      expect(await listAll(harness.root)).toEqual(['子目录/中文 文件.bin'])
    } finally {
      await harness.close()
    }
  })

  it('rejects traversal, absolute paths, missing files, wrong methods, and unknown sessions', async () => {
    const harness = await serve({})
    try {
      expect((await fetch(`${harness.base}upload?sessionId=live&path=..`, { method: 'POST', headers: AUTH, body: 'x' })).status).toBe(400)
      expect((await fetch(`${harness.base}upload?sessionId=live&path=${encodeURIComponent('a/../../etc/passwd')}`, { method: 'POST', headers: AUTH, body: 'x' })).status).toBe(400)
      expect((await fetch(`${harness.base}upload?sessionId=live&path=${encodeURIComponent('/etc/passwd')}`, { method: 'POST', headers: AUTH, body: 'x' })).status).toBe(400)
      expect((await fetch(`${harness.base}download?sessionId=live&path=missing`, { headers: AUTH })).status).toBe(404)
      expect((await fetch(`${harness.base}download?sessionId=live&path=`, { headers: AUTH })).status).toBe(400)
      expect((await fetch(`${harness.base}download?sessionId=ghost&path=a`, { headers: AUTH })).status).toBe(404)
      expect((await fetch(`${harness.base}download?sessionId=live&path=a`, { method: 'POST', headers: AUTH })).status).toBe(405)
      expect((await fetch(`${harness.base}upload?sessionId=live&path=a`, { headers: AUTH })).status).toBe(405)
    } finally {
      await harness.close()
    }
  })

  it('blocks symlink escapes on upload and download', async () => {
    const outside = await tempDir('dsh-transfer-outside-')
    const harness = await serve({})
    try {
      await writeFile(join(outside, 'secret'), 'secret')
      await symlink(join(outside, 'secret'), join(harness.root, 'link-out'))
      const down = await fetch(`${harness.base}download?sessionId=live&path=link-out`, { headers: AUTH })
      expect(down.status).toBe(400)
      const up = await fetch(`${harness.base}upload?sessionId=live&path=link-out`, { method: 'POST', headers: AUTH, body: 'x' })
      expect(up.status).toBe(409)
    } finally {
      await harness.close()
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('packages a folder as a valid zip: unicode names, empty dirs, symlinks skipped', async () => {
    const harness = await serve({})
    try {
      await mkdir(join(harness.root, 'sub', 'deep'), { recursive: true })
      await mkdir(join(harness.root, 'empty'))
      const bin = Buffer.from([0, 255, 13, 10, 128, 42])
      const text = Buffer.from('中文内容\n'.repeat(3))
      const big = Buffer.alloc(200_000, 97)
      await writeFile(join(harness.root, 'sub', '中文 file.bin'), bin)
      await writeFile(join(harness.root, 'sub', 'deep', 'note.txt'), text)
      await writeFile(join(harness.root, 'sub', 'big.txt'), big)
      await writeFile(join(harness.root, 'top.md'), '# top')
      const outside = await tempDir('dsh-transfer-outside-')
      await writeFile(join(outside, 'secret'), 'secret')
      await symlink(join(outside, 'secret'), join(harness.root, 'sub', 'link-out'))

      const res = await fetch(`${harness.base}download-dir?sessionId=live&path=sub`, { headers: AUTH })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('content-disposition')).toContain('filename="sub.zip"')
      const entries = parseZip(Buffer.from(await res.arrayBuffer()))
      expect(entries.map((entry) => entry.name).sort()).toEqual(['big.txt', 'deep/', 'deep/note.txt', '中文 file.bin'])
      const byName = new Map(entries.map((entry) => [entry.name, entry]))
      expect(byName.get('deep/')?.uncomp).toBe(0)
      expect(byName.get('中文 file.bin')?.data).toEqual(bin)
      expect(byName.get('deep/note.txt')?.data).toEqual(text)
      expect(byName.get('big.txt')?.data).toEqual(big)
      expect((byName.get('big.txt')?.comp ?? 0)).toBeLessThan(big.length)

      const whole = await fetch(`${harness.base}download-dir?sessionId=live&path=`, { headers: AUTH })
      expect(whole.status).toBe(200)
      const wholeEntries = parseZip(Buffer.from(await whole.arrayBuffer()))
      expect(wholeEntries.map((entry) => entry.name).sort()).toEqual(['empty/', 'sub/', 'sub/big.txt', 'sub/deep/', 'sub/deep/note.txt', 'sub/中文 file.bin', 'top.md'])

      const empty = await fetch(`${harness.base}download-dir?sessionId=live&path=empty`, { headers: AUTH })
      expect(parseZip(Buffer.from(await empty.arrayBuffer())).length).toBe(0)

      expect((await fetch(`${harness.base}download-dir?sessionId=live&path=top.md`, { headers: AUTH })).status).toBe(400)
      expect((await fetch(`${harness.base}download-dir?sessionId=live&path=..`, { headers: AUTH })).status).toBe(400)
      await rm(outside, { recursive: true, force: true })
    } finally {
      await harness.close()
    }
  })

  it('reports the sizes of files in the folder the Files tab is showing', async () => {
    const harness = await serve({})
    try {
      await writeFile(join(harness.root, 'top.md'), '# hi')
      await mkdir(join(harness.root, 'sub', 'empty'), { recursive: true })
      await writeFile(join(harness.root, 'sub', 'a.txt'), Buffer.alloc(2048, 3))
      await writeFile(join(harness.root, 'sub', '中文.bin'), Buffer.alloc(1, 9))

      expect(await sizes(harness, '')).toEqual({ path: '', entries: [{ name: 'top.md', size: 4 }], truncated: false })
      expect(await sizes(harness, 'sub')).toEqual({
        path: 'sub',
        entries: [{ name: 'a.txt', size: 2048 }, { name: '中文.bin', size: 1 }],
        truncated: false,
      })
      expect((await sizes(harness, 'sub/empty')).entries).toEqual([])

      expect((await fetch(`${harness.base}sizes?sessionId=live&path=sub/a.txt`, { headers: AUTH })).status).toBe(400)
      expect((await fetch(`${harness.base}sizes?sessionId=live&path=gone`, { headers: AUTH })).status).toBe(404)
      expect((await fetch(`${harness.base}sizes?sessionId=live&path=../outside`, { headers: AUTH })).status).toBe(400)
      expect((await fetch(`${harness.base}sizes?sessionId=nope&path=`)).status).toBe(401)
    } finally {
      await harness.close()
    }
  })

  it('caps oversized uploads and leaves no temp file behind', async () => {
    const harness = await serve({})
    try {
      const chunk = Buffer.alloc(1024 * 1024, 1)
      const req = fakeReq(async function* (): AsyncGenerator<Buffer> {
        for (let i = 0; i < 300; i++) yield chunk
      })
      await expect(uploadFile(req, harness.root, 'big.bin')).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
      expect(await listAll(harness.root)).toEqual([])
    } finally {
      await harness.close()
    }
  })

  it('cleans up the temp file when an upload is cut off mid-stream', async () => {
    const harness = await serve({})
    try {
      const chunk = Buffer.alloc(1024, 7)
      const req = fakeReq(async function* (): AsyncGenerator<Buffer> {
        for (let i = 0; i < 64; i++) yield chunk
        throw new Error('client aborted')
      })
      await expect(uploadFile(req, harness.root, 'half.bin')).rejects.toMatchObject({ code: 'FS_WRITE_FAILED' })
      expect(await listAll(harness.root)).toEqual([])
    } finally {
      await harness.close()
    }
  })
})

/** A request that only behaves like a stream, so size caps and aborts are exactly controlled. */
function fakeReq(body: () => AsyncGenerator<Buffer>): IncomingMessage {
  return { headers: {}, [Symbol.asyncIterator]: body } as unknown as IncomingMessage
}

interface SizeListing {
  path: string
  entries: Array<{ name: string; size: number }>
  truncated: boolean
}

async function sizes(harness: Harness, path: string): Promise<SizeListing> {
  const res = await fetch(`${harness.base}sizes?sessionId=live&path=${encodeURIComponent(path)}`, { headers: AUTH })
  expect(res.status).toBe(200)
  const body = await res.json() as { value: SizeListing }
  return { ...body.value, entries: [...body.value.entries].sort((left, right) => left.name.localeCompare(right.name)) }
}
