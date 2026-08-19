/**
 * Tests for the workbench-sounds HTTP API.
 * 1. multipart upload parser — regression: uploads failed with
 *    "buffer.split is not a function" because Buffer has no split() (String only).
 * 2. GET streaming — regression: preview failed with
 *    "The 'cb' argument must be of type function" because `stat` was imported
 *    from node:fs (callback API) but awaited like node:fs/promises.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSoundsRequest, parseMultipart } from '../src/host/workbench-sounds/http.ts'
import { soundsCustomDir, soundsIndexPath } from '../src/host/workbench-sounds/store.ts'

function buildMultipart(boundary: string, filename: string, contentType: string, data: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return Buffer.concat([head, data, tail])
}

describe('parseMultipart', () => {
  it('parses a simple ASCII file upload', async () => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const data = Buffer.from('hello audio world')
    const parsed = await parseMultipart(buildMultipart(boundary, 'note.txt', 'text/plain', data), boundary)
    expect(parsed).not.toBeNull()
    expect(parsed!.filename).toBe('note.txt')
    expect(parsed!.data.equals(data)).toBe(true)
  })

  it('parses binary audio bytes without corruption (wav)', async () => {
    const boundary = '----dshBoundary123'
    // Binary bytes: NULs, CR/LF inside the payload, and a fragment that
    // resembles the boundary marker to stress the byte-level split.
    const data = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, // RIFF
      0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, // WAVEfmt
      0x0d, 0x0a, 0x00, 0x01, 0x02, 0x00, 0x80, 0xbb, // \r\n + PCM data
      0x00, 0x00, 0x00, 0x00, 0x2d, 0x2d, 0x64, 0x73, // "----ds" (boundary-like)
      0x68, 0x42, 0x6f, 0x75, 0x6e, 0x64, 0x61, 0x72, // "hBoundar" fragment
      0x79, 0x46, 0x72, 0x61, 0x67, 0x6d, 0x65, 0x6e, // "yFragmen"
      0x74, 0x00, 0xff, 0xfe, 0xfd, 0x0a, 0x0d, 0x00, // "t" + binary tail
    ])
    const parsed = await parseMultipart(buildMultipart(boundary, 'beep.wav', 'audio/wav', data), boundary)
    expect(parsed).not.toBeNull()
    expect(parsed!.filename).toBe('beep.wav')
    expect(parsed!.data.equals(data)).toBe(true)
  })

  it('parses mp3 content and reports the exact filename', async () => {
    const boundary = '----WebKitFormBoundaryabc'
    const data = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]) // ID3 header
    const parsed = await parseMultipart(buildMultipart(boundary, 'my song.mp3', 'audio/mpeg', data), boundary)
    expect(parsed).not.toBeNull()
    expect(parsed!.filename).toBe('my song.mp3')
    expect(parsed!.data.equals(data)).toBe(true)
  })

  it('returns null when the body has no file part', async () => {
    const boundary = 'xyz'
    const body = Buffer.from(
      `--xyz\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--xyz--\r\n`,
    )
    expect(await parseMultipart(body, boundary)).toBeNull()
  })

  it('returns null for a body without any boundary', async () => {
    const body = Buffer.from('no multipart here at all')
    expect(await parseMultipart(body, 'missing')).toBeNull()
  })
})

/** Collecting fake ServerResponse: a Writable so createReadStream#pipe works. */
class CollectResponse extends Writable {
  statusCode = 200
  headers: Record<string, string> = {}
  chunks: Buffer[] = []

  setHeader(name: string, value: string): void {
    this.headers[name] = value
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, cb: () => void): void {
    this.chunks.push(Buffer.from(chunk))
    cb()
  }

  body(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

async function send(req: Partial<IncomingMessage>): Promise<CollectResponse> {
  const res = new CollectResponse()
  const finished = new Promise<void>((resolve) => res.on('finish', resolve))
  await handleSoundsRequest(req as IncomingMessage, res as unknown as ServerResponse)
  await finished
  return res
}

describe('GET /workbench-sounds/{id} streaming', () => {
  const SOUND_ID = 'abc12345'
  const originalHome = process.env.DSH_HOME
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-sounds-'))
    process.env.DSH_HOME = home
    await mkdir(soundsCustomDir(), { recursive: true })
    const audio = Buffer.from([0x00, 0x01, 0x02, 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0x7f]) // fake binary audio
    await writeFile(join(soundsCustomDir(), `${SOUND_ID}.m4a`), audio)
    const index = {
      version: 1,
      custom: [{
        id: SOUND_ID,
        name: 'ceshi',
        nameZh: 'ceshi',
        kind: 'custom',
        url: `${SOUND_ID}.m4a`,
        filename: 'ceshi.m4a',
        mimeType: 'audio/mp4',
        size: audio.length,
      }],
    }
    await writeFile(soundsIndexPath(), `${JSON.stringify(index)}\n`)
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    await rm(home, { recursive: true, force: true })
  })

  it('streams the stored audio file with the right mime type and exact bytes', async () => {
    const res = await send({ method: 'GET', headers: { host: '127.0.0.1:3080' }, url: `/workbench-sounds/${SOUND_ID}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/mp4')
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['content-length']).toBe(9)
    expect(res.body().equals(Buffer.from([0x00, 0x01, 0x02, 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0x7f]))).toBe(true)
  })

  it('serves a byte subrange as 206 with content-range (bytes=0-3)', async () => {
    const res = await send({
      method: 'GET',
      headers: { host: '127.0.0.1:3080', range: 'bytes=0-3' },
      url: `/workbench-sounds/${SOUND_ID}`,
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-3/9')
    expect(res.headers['content-length']).toBe(4)
    expect(res.body().equals(Buffer.from([0x00, 0x01, 0x02, 0x0d]))).toBe(true)
  })

  it('serves an open-ended range as 206 to the end of file (bytes=5-)', async () => {
    const res = await send({
      method: 'GET',
      headers: { host: '127.0.0.1:3080', range: 'bytes=5-' },
      url: `/workbench-sounds/${SOUND_ID}`,
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 5-8/9')
    expect(res.headers['content-length']).toBe(4)
    expect(res.body().equals(Buffer.from([0xff, 0xfe, 0x00, 0x7f]))).toBe(true)
  })

  it('serves a suffix range (bytes=-4) as the last 4 bytes', async () => {
    const res = await send({
      method: 'GET',
      headers: { host: '127.0.0.1:3080', range: 'bytes=-4' },
      url: `/workbench-sounds/${SOUND_ID}`,
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 5-8/9')
    expect(res.body().equals(Buffer.from([0xff, 0xfe, 0x00, 0x7f]))).toBe(true)
  })

  it('rejects an unsatisfiable range with 416', async () => {
    const res = await send({
      method: 'GET',
      headers: { host: '127.0.0.1:3080', range: 'bytes=999-' },
      url: `/workbench-sounds/${SOUND_ID}`,
    })
    expect(res.statusCode).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */9')
  })

  it('returns 404 for an unknown sound id', async () => {
    const res = await send({ method: 'GET', headers: { host: '127.0.0.1:3080' }, url: '/workbench-sounds/zzz99999' })
    expect(res.statusCode).toBe(404)
  })

  it('serves the index JSON on GET /workbench-sounds/', async () => {
    const res = await send({ method: 'GET', headers: { host: '127.0.0.1:3080' }, url: '/workbench-sounds/' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body().toString('utf8'))
    expect(body.ok).toBe(true)
    expect(body.index.custom[0].id).toBe(SOUND_ID)
  })
})

describe('addCustomSound upload size limits', () => {
  const originalHome = process.env.DSH_HOME
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-sounds-size-'))
    process.env.DSH_HOME = home
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    await rm(home, { recursive: true, force: true })
  })

  it('accepts files well above the old 10MB cap (e.g. 11MB)', async () => {
    const { addCustomSound } = await import('../src/host/workbench-sounds/store.ts')
    const big = Buffer.alloc(11 * 1024 * 1024, 0x61) // 11MB 'a' bytes
    const entry = await addCustomSound(big, 'big.mp3', 'big11111')
    expect(entry.size).toBe(11 * 1024 * 1024)
    expect(entry.mimeType).toBe('audio/mpeg')
  })

  it('rejects files larger than the 50MB cap', async () => {
    const { addCustomSound } = await import('../src/host/workbench-sounds/store.ts')
    const tooBig = Buffer.alloc(51 * 1024 * 1024, 0x62) // 51MB
    await expect(addCustomSound(tooBig, 'too-big.mp3', 'big22222')).rejects.toThrow(/max 50MB/)
  })

  it('rejects empty files', async () => {
    const { addCustomSound } = await import('../src/host/workbench-sounds/store.ts')
    await expect(addCustomSound(Buffer.alloc(0), 'empty.mp3', 'empty0001')).rejects.toThrow(/Empty file/)
  })
})
