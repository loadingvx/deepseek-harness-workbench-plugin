import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { GitError, toFail } from '../../shared/errors.ts'
import type { GitErrorCode, GitFail } from '../../shared/types.ts'
import { assertTransferPath, resolveInsideRoot } from './paths.ts'
import { downloadFile } from './download.ts'
import { downloadDirectoryZip } from './zip.ts'
import { uploadFile } from './upload.ts'
import { listFileSizes } from './sizes.ts'

/** Host-side gate installed by the web server; the same door the official `/api` uses. */
interface ConnectionGate {
  requestRejection(req: IncomingMessage): number | undefined
}

interface SessionEntry {
  header?: { cwd?: string }
}

interface SessionRegistry {
  get(id: string): SessionEntry | undefined
}

type TransferAction = 'upload' | 'download' | 'download-dir' | 'sizes'

const STATUS: Partial<Record<GitErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  UNKNOWN_WORKSPACE: 404,
  FS_NOT_FOUND: 404,
  INVALID_PATH: 400,
  FS_IS_DIRECTORY: 400,
  BAD_REQUEST: 405,
  FS_EXISTS: 409,
  FS_TOO_LARGE: 413,
  FS_WRITE_FAILED: 500,
}

function sendFail(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    // A stream already started; the only honest way to signal truncation is to cut it.
    res.destroy()
    return
  }
  const body: GitFail = error instanceof GitError ? error.toFail() : toFail(error)
  const json = JSON.stringify(body)
  res.statusCode = STATUS[body.code] ?? 400
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(json)
}

/**
 * Upload / download / folder-zip routes for the Files tab.
 *
 * These are `exact` routes under the workbench `/git` prefix, so they win over
 * the JSON API handler while sharing its host. Every request is gated by the
 * web server's own connection fence (Host/Origin plus the login cookie) and is
 * scoped to the session workspace, which is what the Files tab lists.
 */
export function registerFileTransferHttp(ctx: Context): () => void {
  const server = ctx.webServer
  if (server === undefined || typeof server.register !== 'function') return () => {}
  const disposers: Array<() => void> = []

  const route = (action: TransferAction) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // Resolved per request: this plugin does not inject `connection`, and an effect can run
      // before the fence is published. Missing fence means refused, never unguarded.
      const connection = ctx.get('connection') as ConnectionGate | undefined
      if (connection === undefined || typeof connection.requestRejection !== 'function') throw new GitError('AUTH_REQUIRED')
      const sessions = ctx.get('sessions') as SessionRegistry | undefined
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) throw new GitError('AUTH_REQUIRED')
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== (action === 'upload' ? 'POST' : 'GET')) throw new GitError('BAD_REQUEST')
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'transfer.invalid'}`)
      const sessionId = url.searchParams.get('sessionId')
      const root = sessionId === null || sessions === undefined ? undefined : sessions.get(sessionId)?.header?.cwd
      if (root === undefined) throw new GitError('UNKNOWN_WORKSPACE')
      const path = assertTransferPath(url.searchParams.get('path') ?? '')
      if (action === 'sizes') {
        const value = await listFileSizes(root, path)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify({ ok: true, value }))
        return
      }
      if (action === 'upload') {
        const value = await uploadFile(req, root, path)
        if (res.headersSent) return
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify({ ok: true, value }))
        return
      }
      if (action === 'download') {
        await downloadFile(res, root, path)
        return
      }
      await downloadDirectoryZip(res, root, path)
    } catch (error) {
      sendFail(res, error)
    }
  }

  disposers.push(
    server.register({ kind: 'exact', path: '/git/fs/upload', handler: route('upload') }),
    server.register({ kind: 'exact', path: '/git/fs/download', handler: route('download') }),
    server.register({ kind: 'exact', path: '/git/fs/download-dir', handler: route('download-dir') }),
    server.register({ kind: 'exact', path: '/git/fs/sizes', handler: route('sizes') }),
  )
  return () => {
    for (const dispose of disposers) dispose()
  }
}
