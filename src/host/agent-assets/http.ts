import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentAssetDraft, AgentAssetFamily } from '../../shared/agent-assets.ts'
import { fail, toFail } from '../../shared/errors.ts'
import type { GitResult } from '../../shared/types.ts'
import { resolveWorkspacePath } from '../workspace.ts'
import { WorkspaceFs } from '../workspace-fs.ts'
import { RulePromptBinder } from './inject.ts'
import { AgentAssetStore } from './store.ts'

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
      if (size > 400_000) {
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

function familyOf(raw: string | undefined): AgentAssetFamily | undefined {
  return raw === 'skill' || raw === 'rule' ? raw : undefined
}

function draftFrom(body: Record<string, unknown>, fallback?: { name?: string }): AgentAssetDraft {
  const name = typeof body.name === 'string' ? body.name : (fallback?.name ?? '')
  return {
    name,
    description: typeof body.description === 'string' ? body.description : '',
    whenToUse: typeof body.whenToUse === 'string' ? body.whenToUse : '',
    content: typeof body.content === 'string' ? body.content : '',
    enabled: body.enabled === false ? false : true,
  }
}

function listWorkspaces(ctx: Context): Array<{ path: string }> {
  const registry = ctx.get('workspaceRegistry') as {
    list?: () => Array<{ path: string }>
  } | undefined
  const rows = registry?.list?.()
  return Array.isArray(rows) ? rows.filter(row => typeof row.path === 'string' && row.path !== '') : []
}

/**
 * JSON API for control-plane Skills / Rules tabs.
 * Prefix: `/git/agent-assets`
 */
export function registerAgentAssets(ctx: Context, fs = new WorkspaceFs()): () => void {
  const server = ctx.webServer
  if (server === undefined || typeof server.register !== 'function') {
    return () => {}
  }
  const store = new AgentAssetStore(fs)
  const binder = new RulePromptBinder(ctx, store, () => listWorkspaces(ctx))
  const unwire = binder.wire()

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/git/agent-assets', `http://${host}`)
    const route = url.pathname.replace(/\/+$/, '') || '/git/agent-assets'
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    let result: GitResult<unknown>
    try {
      const family = familyOf(query(url, 'family') ?? (route.endsWith('/skills') ? 'skill' : route.endsWith('/rules') ? 'rule' : undefined))
      if (method === 'GET' && (route === '/git/agent-assets/skills' || route === '/git/agent-assets/rules')) {
        const workspaceId = query(url, 'workspaceId')
        const root = resolveWorkspacePath(ctx, workspaceId)
        result = { ok: true, value: await store.list(root, family ?? (route.endsWith('/skills') ? 'skill' : 'rule')) }
      } else if (method === 'POST' && route === '/git/agent-assets/create') {
        const body = await readJson(req)
        const kind = familyOf(typeof body.family === 'string' ? body.family : undefined)
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
        if (kind === undefined) {
          result = fail('ASSET_INVALID', '请指定是 Skill 还是规则。')
        } else {
          const root = resolveWorkspacePath(ctx, workspaceId)
          const created = await store.create(root, kind, draftFrom(body))
          if (kind === 'rule') await binder.refreshWorkspace(root)
          result = { ok: true, value: created }
        }
      } else if (method === 'POST' && route === '/git/agent-assets/update') {
        const body = await readJson(req)
        const kind = familyOf(typeof body.family === 'string' ? body.family : undefined)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        const relPath = typeof body.relPath === 'string' ? body.relPath : undefined
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
        if (kind === undefined || name === '') {
          result = fail('ASSET_INVALID', '请指定要保存的条目名称。')
        } else {
          const root = resolveWorkspacePath(ctx, workspaceId)
          const patch: Partial<AgentAssetDraft> = {}
          if (typeof body.description === 'string') patch.description = body.description
          if (typeof body.whenToUse === 'string') patch.whenToUse = body.whenToUse
          if (typeof body.content === 'string') patch.content = body.content
          if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
          const updated = await store.update(root, kind, name, patch, relPath)
          if (kind === 'rule') await binder.refreshWorkspace(root)
          result = { ok: true, value: updated }
        }
      } else if (method === 'POST' && route === '/git/agent-assets/enable') {
        const body = await readJson(req)
        const kind = familyOf(typeof body.family === 'string' ? body.family : undefined)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        const relPath = typeof body.relPath === 'string' ? body.relPath : undefined
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
        if (kind === undefined || name === '' || typeof body.enabled !== 'boolean') {
          result = fail('ASSET_INVALID', '请指定要启用或停用的条目。')
        } else {
          const root = resolveWorkspacePath(ctx, workspaceId)
          const updated = await store.setEnabled(root, kind, name, body.enabled, relPath)
          if (kind === 'rule') await binder.refreshWorkspace(root)
          result = { ok: true, value: updated }
        }
      } else if (method === 'POST' && route === '/git/agent-assets/delete') {
        const body = await readJson(req)
        const kind = familyOf(typeof body.family === 'string' ? body.family : undefined)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        const relPath = typeof body.relPath === 'string' ? body.relPath : undefined
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
        if (kind === undefined || name === '') {
          result = fail('ASSET_INVALID', '请指定要删除的条目。')
        } else {
          const root = resolveWorkspacePath(ctx, workspaceId)
          await store.remove(root, kind, name, relPath)
          if (kind === 'rule') await binder.refreshWorkspace(root)
          result = { ok: true, value: { name } }
        }
      } else {
        result = fail('ASSET_INVALID', '未知的 Skills / Rules 接口。请刷新页面后再试。')
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        result = fail('ASSET_INVALID', '请求内容不是合法数据。请刷新页面后再试。')
      } else if (error instanceof Error && error.message === 'body too large') {
        result = fail('ASSET_INVALID', '内容太大，没法保存。请缩短正文后再试。')
      } else {
        result = toFail(error)
      }
    }
    send(res, result.ok ? 200 : 400, result)
  }

  const disposeRoute = server.register({
    kind: 'prefix',
    path: '/git/agent-assets',
    handler,
  })

  return () => {
    try { disposeRoute() } catch { /* ignore */ }
    unwire()
  }
}
