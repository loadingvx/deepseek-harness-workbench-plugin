/**
 * HTTP API for workbench sounds.
 *
 * GET  /workbench-sounds/          → sound index JSON
 * GET  /workbench-sounds/{id}      → stream audio file (custom sounds only)
 * POST /workbench-sounds/          → upload new sound (multipart/form-data)
 * DELETE /workbench-sounds/{id}   → delete custom sound
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SoundIndex } from '../../shared/workbench-sounds/types.ts'
import { HTTP_PREFIX, MAX_SOUND_UPLOAD_BYTES } from '../../shared/workbench-sounds/types.ts'
import {
  addCustomSound,
  deleteCustomSound,
  getCustomSoundPath,
  loadSoundIndex,
  mimeFromExt,
  soundsCustomDir,
} from './store.ts'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, message }))
}

function parseBody(req: IncomingMessage, maxSize = 12 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Split a Buffer by a separator Buffer.
 * Node's Buffer has no split() (that is a String method), so we search for the
 * separator bytes with Buffer#indexOf and slice with subarray.
 */
function splitBuffer(buf: Buffer, sep: Buffer): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  let idx = buf.indexOf(sep, start)
  while (idx !== -1) {
    parts.push(buf.subarray(start, idx))
    start = idx + sep.length
    idx = buf.indexOf(sep, start)
  }
  parts.push(buf.subarray(start))
  return parts
}

/** Minimal multipart/form-data parser (no external deps). */
export async function parseMultipart(buffer: Buffer, boundary: string): Promise<{ filename: string; data: Buffer } | null> {
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const parts = splitBuffer(buffer, boundaryBuf)
  for (const part of parts) {
    // Every part after the first is prefixed with the CRLF of the previous
    // delimiter (`\r\n--boundary`). Strip it with exact byte offsets instead
    // of trim(), so binary file data that legitimately ends in whitespace
    // bytes (e.g. 0x0d 0x0a) is never altered.
    let body = part
    if (body.length >= 2 && body[0] === 0x0d && body[1] === 0x0a) body = body.subarray(2)
    if (body.length === 0 || body.toString().startsWith('--')) continue
    const idx = body.indexOf('\r\n\r\n')
    if (idx < 0) continue
    const header = body.subarray(0, idx).toString()
    let fileData = body.subarray(idx + 4)
    // Strip the single framing CRLF that precedes the next delimiter, if present.
    if (fileData.length >= 2 && fileData[fileData.length - 2] === 0x0d && fileData[fileData.length - 1] === 0x0a) {
      fileData = fileData.subarray(0, fileData.length - 2)
    }
    const filenameMatch = header.match(/filename="([^"]+)"/)
    if (!filenameMatch) continue
    const filename = filenameMatch[1]
    return { filename, data: fileData }
  }
  return null
}

export async function handleSoundsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const host = req.headers.host ?? '127.0.0.1'
  const url = new URL(req.url ?? HTTP_PREFIX, `http://${host}`)
  const route = url.pathname.replace(/\/+$/, '') || HTTP_PREFIX
  const method = (req.method ?? 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.end()
    return
  }

  // CORS for browser access
  res.setHeader('access-control-allow-origin', '*')

  try {
    // GET /workbench-sounds/ → index
    if (method === 'GET' && (route === HTTP_PREFIX || route === `${HTTP_PREFIX}/index`)) {
      const index = await loadSoundIndex()
      sendJson(res, 200, { ok: true, index })
      return
    }

    // GET /workbench-sounds/{id} → stream file（支持 Range 分片，供浏览器媒体播放/拖动进度）
    if (method === 'GET' && route.startsWith(`${HTTP_PREFIX}/`)) {
      const id = basename(route.slice(HTTP_PREFIX.length + 1))
      const filepath = await getCustomSoundPath(id)
      if (!filepath) {
        sendError(res, 404, 'Sound not found')
        return
      }
      // 直接传完整路径（mimeFromExt 内部用 path.extname 取扩展名；
      // 若传 `.${ext}` 这种前导点字符串，extname('.m4a') 会返回 ''（视为 dotfile），
      // 导致 m4a/webm/flac 全部落到 application/octet-stream，浏览器无法播放）。
      const mime = mimeFromExt(filepath)
      res.setHeader('content-type', mime)
      res.setHeader('accept-ranges', 'bytes')
      const { size } = await stat(filepath)

      // Range: bytes=start-end | bytes=start- | bytes=-suffix
      const range = req.headers.range
      const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
      if (match !== null) {
        let start = match[1] === '' ? undefined : Number(match[1])
        let end = match[2] === '' ? undefined : Number(match[2])
        if (start === undefined) {
          // 后缀范围 bytes=-N：取最后 N 字节
          const suffix = end ?? 0
          start = Math.max(0, size - suffix)
          end = size - 1
        } else if (end === undefined || end >= size) {
          end = size - 1
        }
        if (start > end || start >= size) {
          res.statusCode = 416
          res.setHeader('content-range', `bytes */${size}`)
          res.end()
          return
        }
        res.statusCode = 206
        res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
        res.setHeader('content-length', end - start + 1)
        createReadStream(filepath, { start, end }).pipe(res)
        return
      }

      res.setHeader('content-length', size)
      createReadStream(filepath).pipe(res)
      return
    }

    // POST /workbench-sounds/ → upload
    if (method === 'POST' && route === HTTP_PREFIX) {
      const contentType = req.headers['content-type'] ?? ''
      const match = contentType.match(/multipart\/form-data; boundary=(.+)/)
      if (!match) {
        sendError(res, 400, 'Expected multipart/form-data')
        return
      }
      // multipart 缓冲上限 = 文件上限 + 头部/边界开销余量
      const body = await parseBody(req, MAX_SOUND_UPLOAD_BYTES + 2 * 1024 * 1024)
      const parsed = await parseMultipart(body, match[1])
      if (!parsed) {
        sendError(res, 400, 'No file found in multipart body')
        return
      }
      const id = randomUUID().slice(0, 8)
      const entry = await addCustomSound(parsed.data, parsed.filename, id)
      sendJson(res, 200, { ok: true, entry })
      return
    }

    // DELETE /workbench-sounds/{id}
    if (method === 'DELETE' && route.startsWith(`${HTTP_PREFIX}/`)) {
      const id = basename(route.slice(HTTP_PREFIX.length + 1))
      await deleteCustomSound(id)
      sendJson(res, 200, { ok: true })
      return
    }

    sendError(res, 404, 'Not found')
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    sendError(res, 500, detail)
  }
}

export function registerSoundsHttp(
  server: {
    register(opts: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  },
): () => void {
  return server.register({
    kind: 'prefix',
    path: HTTP_PREFIX,
    handler: (req, res) => {
      void handleSoundsRequest(req, res)
    },
  })
}
