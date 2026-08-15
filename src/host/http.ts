import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { fail, toFail } from '../shared/errors.ts'
import type { GitResult } from '../shared/types.ts'
import { generateCommitMessage } from './commit-message.ts'
import type { GitService } from './git-service.ts'
import { resolveWorkspacePath } from './workspace.ts'
import type { WorkspaceFs } from './workspace-fs.ts'

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(json)
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

async function wrap<T>(run: () => Promise<T>): Promise<GitResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return toFail(error)
  }
}

/** Register the `/git` JSON API used by the sidebar panel and workbench. */
export function registerGitHttp(ctx: Context, git: GitService, fs: WorkspaceFs): () => void {
  const server = ctx.webServer
  if (server === undefined) {
    throw new Error('dsh-workbench-plugin: 需要 webServer 才能提供工作台接口，请把本插件装到 web profile。')
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/git', `http://${host}`)
    const route = url.pathname.replace(/\/+$/, '') || '/git'
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const workspaceId = query(url, 'workspaceId')
    const rootOf = (body?: Record<string, unknown>): string => {
      const id = typeof body?.workspaceId === 'string' ? body.workspaceId : workspaceId
      return resolveWorkspacePath(ctx, id)
    }

    let result: GitResult<unknown>
    try {
      if (method === 'GET' && route === '/git/probe') {
        result = await wrap(() => git.probe(rootOf()))
      } else if (method === 'GET' && route === '/git/status') {
        result = await wrap(() => git.status(rootOf()))
      } else if (method === 'GET' && route === '/git/diff') {
        const path = query(url, 'path')
        const staged = query(url, 'staged') === '1'
        result = await wrap(() => git.diff(rootOf(), path, staged))
      } else if (method === 'GET' && route === '/git/log') {
        const limit = Number(query(url, 'limit') ?? '20')
        result = await wrap(() => git.log(rootOf(), Number.isFinite(limit) ? limit : 20))
      } else if (method === 'GET' && route === '/git/branches') {
        result = await wrap(() => git.branches(rootOf()))
      } else if (method === 'POST' && route === '/git/stage') {
        const body = await readJson(req)
        result = await wrap(async () => {
          await git.stage(rootOf(body), asStringArray(body.paths))
          return { done: true }
        })
      } else if (method === 'POST' && route === '/git/unstage') {
        const body = await readJson(req)
        result = await wrap(async () => {
          await git.unstage(rootOf(body), asStringArray(body.paths))
          return { done: true }
        })
      } else if (method === 'POST' && route === '/git/commit') {
        const body = await readJson(req)
        const message = typeof body.message === 'string' ? body.message : ''
        const all = body.all === true
        result = await wrap(() => git.commit(rootOf(body), message, all))
      } else if (method === 'POST' && route === '/git/commit-message') {
        const body = await readJson(req)
        result = await wrap(async () => {
          const message = await generateCommitMessage(ctx, git, rootOf(body))
          return { message }
        })
      } else if (method === 'POST' && route === '/git/switch') {
        const body = await readJson(req)
        const name = typeof body.name === 'string' ? body.name : ''
        result = await wrap(() => git.switchBranch(rootOf(body), name))
      } else if (method === 'GET' && route === '/git/fs/list') {
        result = await wrap(() => fs.list(rootOf(), query(url, 'path') ?? ''))
      } else if (method === 'GET' && route === '/git/fs/read') {
        const path = query(url, 'path')
        if (path === undefined) {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => fs.read(rootOf(), path))
        }
      } else if (method === 'POST' && route === '/git/fs/write') {
        const body = await readJson(req)
        const path = typeof body.path === 'string' ? body.path : ''
        const content = typeof body.content === 'string' ? body.content : null
        if (path === '' || content === null) {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => fs.write(rootOf(body), path, content))
        }
      } else {
        result = fail('BAD_REQUEST')
      }
    } catch (error) {
      result = toFail(error)
    }

    send(res, result.ok ? 200 : 400, result)
  }

  return server.register({ kind: 'prefix', path: '/git', handler })
}
