/**
 * JSON API for the settings page. Lives under /ultra-slash so it does not
 * collide with DSH or other plugins.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CommandHub } from './register.ts'

export const HTTP_PREFIX = '/ultra-slash'

interface JsonBody {
  commands?: unknown
  defaults?: unknown
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

async function readJson(req: IncomingMessage): Promise<JsonBody> {
  const raw = await readBody(req)
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid json')
  }
  return parsed as JsonBody
}

function asCommandRows(value: unknown): Array<{ name: string; description?: string; steerText: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: Array<{ name: string; description?: string; steerText: string }> = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined
    const row = item as { name?: unknown; description?: unknown; steerText?: unknown }
    if (typeof row.name !== 'string' || typeof row.steerText !== 'string') return undefined
    rows.push({
      name: row.name,
      steerText: row.steerText,
      ...(typeof row.description === 'string' ? { description: row.description } : {}),
    })
  }
  return rows
}

function asDefaults(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export async function handleUltraSlashRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hub: CommandHub,
): Promise<void> {
  const host = req.headers.host ?? '127.0.0.1'
  const url = new URL(req.url ?? HTTP_PREFIX, 'http://' + host)
  const route = url.pathname.replace(/\/+$/, '') || HTTP_PREFIX
  const method = (req.method ?? 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    if (method === 'GET' && route === HTTP_PREFIX + '/commands') {
      send(res, 200, {
        ok: true,
        value: {
          commands: hub.listCustom(),
          defaults: hub.defaults(),
          ...(hub.loadError() === undefined ? {} : { warning: hub.loadError() }),
        },
      })
      return
    }
    if (method === 'PUT' && route === HTTP_PREFIX + '/commands') {
      const body = await readJson(req)
      if (body.commands !== undefined) {
        const rows = asCommandRows(body.commands)
        if (rows === undefined) {
          send(res, 400, {
            ok: false,
            message: '请求格式不对。需要 { "commands": [ { "name", "steerText", "description?" } ] }。',
          })
          return
        }
        const result = await hub.saveCustom(rows)
        if (!result.ok) {
          send(res, 400, result)
          return
        }
      }
      if (body.defaults !== undefined) {
        const defaults = asDefaults(body.defaults)
        if (defaults === undefined) {
          send(res, 400, { ok: false, message: '请求格式不对。defaults 需要是对象。' })
          return
        }
        const result = await hub.saveDefaults(defaults)
        if (!result.ok) {
          send(res, 400, result)
          return
        }
      }
      send(res, 200, {
        ok: true,
        value: {
          commands: hub.listCustom(),
          defaults: hub.defaults(),
        },
      })
      return
    }
    send(res, 404, { ok: false, message: '没有这个接口。' })
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    send(res, 400, { ok: false, message: detail })
  }
}

export function registerUltraSlashHttp(
  server: { register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void },
  hub: CommandHub,
): () => void {
  return server.register({
    kind: 'prefix',
    path: HTTP_PREFIX,
    handler: (req, res) => {
      void handleUltraSlashRequest(req, res, hub)
    },
  })
}
