import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { fail, toFail } from '../shared/errors.ts'
import { parsePullMode, parsePushMode } from '../shared/git-sync-prefs.ts'
import { redactSecrets } from '../shared/redact.ts'
import type { GitFail, GitResult } from '../shared/types.ts'
import { generateCommitMessage, streamCommitMessage } from './commit-message.ts'
import { streamTermAssist } from './term-assist.ts'
import type { GitService } from './git-service.ts'
import { resolveWorkspacePath } from './workspace.ts'
import { ExternalOpen } from './external-open.ts'
import { TerminalHub } from './terminal.ts'
import { sanitizeTermId } from '../shared/new-file-path.ts'
import { checkPluginUpdate } from './update-check.ts'
import type { WorkspaceFs } from './workspace-fs.ts'

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(redactFail(body))
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

function redactFail(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('ok' in body) || (body as { ok?: unknown }).ok !== false) {
    return body
  }
  const failBody = body as GitFail
  return {
    ...failBody,
    messageZh: redactSecrets(failBody.messageZh),
    hintZh: redactSecrets(failBody.hintZh),
  }
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

async function writeCommitMessageStream(
  res: ServerResponse,
  run: (signal: AbortSignal) => AsyncIterable<{ type: 'delta'; text: string } | { type: 'done'; message: string }>,
): Promise<void> {
  const controller = new AbortController()
  let closed = false
  const abort = (): void => {
    closed = true
    controller.abort()
  }
  const onResponseClose = (): void => {
    if (!res.writableEnded) abort()
  }
  res.on('close', onResponseClose)
  res.statusCode = 200
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('connection', 'keep-alive')
  res.setHeader('x-accel-buffering', 'no')
  const writeLine = (body: unknown): void => {
    if (!res.writable || res.writableEnded) return
    res.write(`${JSON.stringify(redactFail(body))}\n`)
  }
  try {
    for await (const event of run(controller.signal)) {
      if (controller.signal.aborted) break
      if (event.type === 'delta') {
        writeLine({ type: 'delta', text: redactSecrets(event.text) })
      } else {
        writeLine({ type: 'done', message: redactSecrets(event.message) })
      }
    }
  } catch (error) {
    if (!closed && !res.destroyed) writeLine(toFail(error))
  } finally {
    res.off('close', onResponseClose)
    if (!res.writableEnded) res.end()
  }
}

/** Register the `/git` JSON API used by the sidebar panel and workbench. */
export function registerGitHttp(
  ctx: Context,
  git: GitService,
  fs: WorkspaceFs,
  editors = new ExternalOpen(fs),
  term = new TerminalHub(),
): () => void {
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
        const limit = Number(query(url, 'limit') ?? '80')
        result = await wrap(() => git.log(rootOf(), Number.isFinite(limit) ? limit : 80))
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
      } else if (method === 'POST' && route === '/git/restore') {
        const body = await readJson(req)
        result = await wrap(async () => {
          await git.restore(rootOf(body), asStringArray(body.paths))
          return { done: true }
        })
      } else if (method === 'POST' && route === '/git/commit') {
        const body = await readJson(req)
        const message = typeof body.message === 'string' ? body.message : ''
        const all = body.all === true
        result = await wrap(() => git.commit(rootOf(body), message, all))
      } else if (method === 'POST' && route === '/git/commit-message/stream') {
        const body = await readJson(req)
        await writeCommitMessageStream(res, (signal) => streamCommitMessage(ctx, git, rootOf(body), {
          signal,
          template: typeof body.template === 'string' ? body.template : undefined,
        }))
        return
      } else if (method === 'POST' && route === '/git/term/assist/stream') {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text : ''
        await writeCommitMessageStream(res, (signal) => streamTermAssist(ctx, {
          signal,
          text,
          cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
          transcript: typeof body.transcript === 'string' ? body.transcript : undefined,
          template: typeof body.template === 'string' ? body.template : undefined,
          prefs: body.prefs,
        }))
        return
      } else if (method === 'POST' && route === '/git/commit-message') {
        const body = await readJson(req)
        result = await wrap(async () => {
          const message = await generateCommitMessage(ctx, git, rootOf(body), {
            template: typeof body.template === 'string' ? body.template : undefined,
          })
          return { message }
        })
      } else if (method === 'POST' && route === '/git/push') {
        const body = await readJson(req)
        result = await wrap(() => git.push(rootOf(body), undefined, parsePushMode(body.pushMode)))
      } else if (method === 'POST' && route === '/git/pull') {
        const body = await readJson(req)
        result = await wrap(() => git.pull(rootOf(body), undefined, parsePullMode(body.pullMode)))
      } else if (method === 'POST' && route === '/git/fetch') {
        const body = await readJson(req)
        result = await wrap(() => git.fetch(rootOf(body)))
      } else if (method === 'POST' && route === '/git/create-branch') {
        const body = await readJson(req)
        const name = typeof body.name === 'string' ? body.name : ''
        result = await wrap(() => git.createBranch(rootOf(body), name))
      } else if (method === 'POST' && route === '/git/merge') {
        const body = await readJson(req)
        const name = typeof body.name === 'string' ? body.name : ''
        result = await wrap(() => git.mergeBranch(rootOf(body), name))
      } else if (method === 'POST' && route === '/git/switch') {
        const body = await readJson(req)
        const name = typeof body.name === 'string' ? body.name : ''
        result = await wrap(() => git.switchBranch(rootOf(body), name))
      } else if (method === 'GET' && route === '/git/fs/list') {
        result = await wrap(() => fs.list(rootOf(), query(url, 'path') ?? ''))
      } else if (method === 'GET' && route === '/git/fs/search') {
        result = await wrap(() => fs.search(rootOf(), query(url, 'q') ?? '', query(url, 'hidden') === '1'))
      } else if (method === 'GET' && route === '/git/fs/read') {
        const path = query(url, 'path')
        if (path === undefined) {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => fs.read(rootOf(), path))
        }
      } else if (method === 'GET' && route === '/git/fs/img') {
        const path = query(url, 'path')
        if (path === undefined) {
          send(res, 400, fail('BAD_REQUEST'))
          return
        }
        try {
          const image = await fs.readImage(rootOf(), path)
          res.statusCode = 200
          res.setHeader('content-type', image.mime)
          res.setHeader('cache-control', 'no-store')
          res.end(image.buffer)
        } catch (error) {
          send(res, 400, toFail(error))
        }
        return
      } else if (method === 'GET' && route === '/git/fs/raw') {
        const path = query(url, 'path')
        if (path === undefined) {
          send(res, 400, fail('BAD_REQUEST'))
          return
        }
        try {
          const data = await fs.readData(rootOf(), path)
          res.statusCode = 200
          res.setHeader('content-type', data.mime)
          res.setHeader('cache-control', 'no-store')
          res.end(data.buffer)
        } catch (error) {
          send(res, 400, toFail(error))
        }
        return
      } else if (method === 'POST' && route === '/git/fs/rename') {
        const body = await readJson(req)
        const from = typeof body.from === 'string' ? body.from : ''
        const to = typeof body.to === 'string' ? body.to : ''
        if (from === '' || to === '') {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => fs.rename(rootOf(body), from, to))
        }
      } else if (method === 'POST' && route === '/git/fs/delete') {
        const body = await readJson(req)
        const path = typeof body.path === 'string' ? body.path : ''
        if (path === '') {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => fs.delete(rootOf(body), path))
        }
      } else if (method === 'GET' && route === '/git/commit-files') {
        const hash = query(url, 'hash')
        if (hash === undefined) {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => git.commitFiles(rootOf(), hash))
        }
      } else if (method === 'GET' && route === '/git/commit-diff') {
        const hash = query(url, 'hash')
        const path = query(url, 'path')
        if (hash === undefined || path === undefined) {
          result = fail('BAD_REQUEST')
        } else {
          result = await wrap(() => git.commitDiff(rootOf(), hash, path))
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
      } else if (method === 'GET' && route === '/git/fs/editors') {
        result = await wrap(() => editors.list())
      } else if (method === 'POST' && route === '/git/fs/open') {
        const body = await readJson(req)
        const path = typeof body.path === 'string' ? body.path : ''
        const app = typeof body.app === 'string' ? body.app : undefined
        result = await wrap(() => editors.open(rootOf(body), path, app))
      } else if (method === 'GET' && route === '/git/term/stream') {
        const id = workspaceId
        if (id === undefined) {
          result = fail('NO_WORKSPACE')
        } else {
          const cols = Number(query(url, 'cols') ?? '80')
          const rows = Number(query(url, 'rows') ?? '24')
          await term.attach(id, rootOf(), res, cols, rows, sanitizeTermId(query(url, 'termId')))
          return
        }
      } else if (method === 'POST' && route === '/git/term/write') {
        const body = await readJson(req)
        const data = typeof body.data === 'string' ? body.data : ''
        result = await wrap(() => term.write(
          typeof body.workspaceId === 'string' ? body.workspaceId : workspaceId ?? '',
          rootOf(body),
          data,
          80,
          24,
          sanitizeTermId(body.termId),
        ))
      } else if (method === 'POST' && route === '/git/term/resize') {
        const body = await readJson(req)
        result = await wrap(() => term.resize(
          typeof body.workspaceId === 'string' ? body.workspaceId : workspaceId ?? '',
          rootOf(body),
          Number(body.cols),
          Number(body.rows),
          sanitizeTermId(body.termId),
        ))
      } else if (method === 'POST' && route === '/git/term/interrupt') {
        const body = await readJson(req)
        result = await wrap(() => term.interrupt(
          typeof body.workspaceId === 'string' ? body.workspaceId : workspaceId ?? '',
          rootOf(body),
          sanitizeTermId(body.termId),
        ))
      } else if (method === 'POST' && route === '/git/term/close') {
        const body = await readJson(req)
        result = await wrap(() => term.close(
          typeof body.workspaceId === 'string' ? body.workspaceId : workspaceId ?? '',
          sanitizeTermId(body.termId),
        ))
      } else if (method === 'GET' && route === '/git/update') {
        result = await wrap(() => checkPluginUpdate())
      } else if (method === 'POST' && route === '/git/term/restart') {
        const body = await readJson(req)
        result = await wrap(() => term.restart(
          typeof body.workspaceId === 'string' ? body.workspaceId : workspaceId ?? '',
          rootOf(body),
          Number(body.cols),
          Number(body.rows),
          sanitizeTermId(body.termId),
        ))
      } else {
        result = fail('BAD_REQUEST')
      }
    } catch (error) {
      result = toFail(error)
    }

    send(res, result.ok ? 200 : 400, result)
  }

  const dispose = server.register({ kind: 'prefix', path: '/git', handler })
  return () => {
    term.disposeAll()
    dispose()
  }
}