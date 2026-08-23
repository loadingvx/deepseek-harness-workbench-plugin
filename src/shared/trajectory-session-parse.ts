/**
 * 会话 node 角色与类型判定 — 避免 context / subtool / 工具块被当成用户消息。
 */
import { resolveCallId, resolveToolName } from './trajectory-tool-extract.ts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

const SKIP_KINDS = new Set([
  'context', 'subtool', 'sub-tool', 'ambient', 'plugin', 'metadata',
  'chip', 'reference', 'ref', 'attachment', 'injection',
])

const SKIP_TYPES = new Set([
  'context', 'subtool', 'sub-tool', 'reference', 'chip', 'metadata',
])

const SKIP_SOURCES = new Set(['context', 'subtool', 'sub-tool', 'ambient', 'reference', 'chip'])

const TOOL_KINDS = new Set(['tool', 'tool-call', 'tool_call', 'toolcall', 'tool_use'])
const TOOL_TYPES = new Set(['tool', 'tool-call', 'tool_call', 'toolcall', 'tool_use'])

export function isSessionToolRow(row: Record<string, unknown>): boolean {
  const role = lower(row.role)
  if (role === 'tool' || role === 'user' || role === 'assistant' || role === 'system') return false

  const kind = lower(row.kind)
  const type = lower(row.type)
  if (TOOL_KINDS.has(kind) || TOOL_TYPES.has(type)) return true
  if (typeof row.toolName === 'string' && row.toolName.trim() !== '') return true

  const callId = resolveCallId(row)
  const toolName = resolveToolName(row)
  return callId !== undefined && toolName !== undefined
}

function isSkippedContextRow(row: Record<string, unknown>): boolean {
  const kind = lower(row.kind)
  const type = lower(row.type)
  const source = lower(row.source)
  const label = lower(row.label)
  const name = lower(row.name)

  if (SKIP_KINDS.has(kind) || SKIP_TYPES.has(type)) return true
  if (SKIP_SOURCES.has(source)) return true
  if (label.includes('context') || label.includes('subtool')) return true
  if (name === 'context' || name === 'subtool' || name.includes('sub-tool')) return true
  if (row.isContext === true || row.context === true) return true
  return false
}

/** 仅当该行是真实对话消息时返回 role，否则 null。 */
export function resolveSessionMessageRole(row: Record<string, unknown>): string | null {
  if (isSessionToolRow(row)) return null
  if (isSkippedContextRow(row)) return null

  const kind = lower(row.kind)
  const type = lower(row.type)

  if (kind === 'assistant' || kind === 'agent' || type === 'assistant') return 'assistant'
  if (kind === 'system' || type === 'system') return 'system'
  if (kind === 'tool' || type === 'tool') return 'tool'

  const role = lower(row.role)
  if (role === 'assistant' || role === 'system' || role === 'tool') return role

  if (role === 'user') {
    if (kind !== '' && kind !== 'user' && kind !== 'message' && kind !== 'turn') return null
    if (type !== '' && type !== 'user' && type !== 'message') return null
    return 'user'
  }

  if (kind === 'user' || type === 'user') return 'user'
  return null
}

/** 从 session 顶层 nodes 提取对话消息（避免深度展平污染）。 */
export function extractSessionMessages(nodes: readonly unknown[] | undefined): Record<string, unknown>[] {
  if (nodes === undefined) return []
  const out: Record<string, unknown>[] = []

  const pushRow = (row: Record<string, unknown>): void => {
    const role = resolveSessionMessageRole(row)
    if (role === null) return
    out.push({ ...row, role })
  }

  for (const item of nodes) {
    const row = asRecord(item)
    if (row === null) continue

    pushRow(row)

    const kind = lower(row.kind)
    if (kind === 'turn' || kind === 'message' || kind === 'user-turn' || kind === 'assistant-turn') {
      for (const block of [row.blocks, row.children, row.messages].flatMap(x => (Array.isArray(x) ? x : []))) {
        const child = asRecord(block)
        if (child !== null) pushRow(child)
      }
    }
  }

  return out
}
