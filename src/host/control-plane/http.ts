import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { fail, toFail } from '../../shared/errors.ts'
import type { ControlPlaneKnobPatch } from '../../shared/control-plane.ts'
import type { GitResult } from '../../shared/types.ts'
import { ControlPlaneService } from './service.ts'
import { ControlPlaneKnobStore } from './store.ts'
import { buildHostTrajectory } from './trajectory.ts'

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
      if (size > 200_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid json')
  }
  return parsed as Record<string, unknown>
}

function query(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)
  return value === null || value === '' ? undefined : value
}

/**
 * Register `/git/control-plane` JSON API + wire agent waterfalls.
 * Returns a disposer that tears down both HTTP and listeners.
 */
export function registerControlPlane(ctx: Context): () => void {
  const server = ctx.webServer
  if (server === undefined || typeof server.register !== 'function') {
    return () => {}
  }

  const store = new ControlPlaneKnobStore()
  const service = new ControlPlaneService(ctx, store)
  const unwire = service.wire()

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/git/control-plane', `http://${host}`)
    const route = url.pathname.replace(/\/+$/, '') || '/git/control-plane'
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    let result: GitResult<unknown>
    try {
      if (method === 'GET' && route === '/git/control-plane') {
        const sessionId = query(url, 'sessionId')
        result = { ok: true, value: await service.snapshot(sessionId) }
      } else if (method === 'GET' && route === '/git/control-plane/trajectory') {
        const sessionId = query(url, 'sessionId')
        result = { ok: true, value: await buildHostTrajectory(ctx, sessionId) }
      } else if (method === 'POST' && route === '/git/control-plane/knobs') {
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (sessionId === '') {
          result = fail('BAD_REQUEST', '缺少 sessionId。请先打开左侧会话，再调整控制面旋钮。')
        } else {
          const patch: ControlPlaneKnobPatch = {}
          if (body.reset === true) patch.reset = true
          if (Object.prototype.hasOwnProperty.call(body, 'modelOverride')) {
            patch.modelOverride = body.modelOverride as ControlPlaneKnobPatch['modelOverride']
          }
          if (Object.prototype.hasOwnProperty.call(body, 'toolDeny')) {
            patch.toolDeny = body.toolDeny as string[]
          }
          if (typeof body.promptAppend === 'string') patch.promptAppend = body.promptAppend
          if (typeof body.preStepReject === 'boolean') patch.preStepReject = body.preStepReject
          const knobs = store.patch(sessionId, patch)
          service.rebind(sessionId)
          result = { ok: true, value: { knobs, snapshot: await service.snapshot(sessionId) } }
        }
      } else {
        result = fail('BAD_REQUEST', '未知的控制面接口。')
      }
    } catch (error) {
      result = toFail(error)
    }
    send(res, result.ok ? 200 : 400, result)
  }

  const disposeRoute = server.register({
    kind: 'prefix',
    path: '/git/control-plane',
    handler,
  })

  return () => {
    try { disposeRoute() } catch { /* ignore */ }
    unwire()
  }
}
