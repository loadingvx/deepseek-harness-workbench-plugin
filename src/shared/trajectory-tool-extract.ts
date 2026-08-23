/**
 * 从 harness 会话块 / runningCalls / OpenAI tool_calls 中抽取工具 ID、名称与参数。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function argsToRaw(args: unknown): string {
  if (typeof args === 'string') return args
  if (args === undefined || args === null) return '{}'
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function isEmptyArgsRaw(raw: string): boolean {
  const trimmed = raw.trim()
  return trimmed === '' || trimmed === '{}'
}

/** 新参数是否比旧参数更完整。 */
export function isRicherArgsRaw(next: string, prev: string): boolean {
  if (isEmptyArgsRaw(next)) return false
  if (isEmptyArgsRaw(prev)) return true
  return next.trim().length > prev.trim().length
}

export function pickRicherArgsRaw(a: string, b: string): string {
  return isRicherArgsRaw(a, b) ? a : (isRicherArgsRaw(b, a) ? b : a)
}

const CALL_ID_KEYS = ['callId', 'call_id', 'toolCallId', 'tool_call_id'] as const

function hasToolShape(row: Record<string, unknown>): boolean {
  if (typeof row.toolName === 'string' && row.toolName.trim() !== '') return true
  const kind = typeof row.kind === 'string' ? row.kind.toLowerCase() : ''
  const type = typeof row.type === 'string' ? row.type.toLowerCase() : ''
  if (['tool', 'tool-call', 'tool_call', 'toolcall', 'tool_use'].includes(kind)) return true
  if (['tool', 'tool-call', 'tool_call', 'toolcall', 'tool_use'].includes(type)) return true
  if (typeof row.argsRaw === 'string' && row.argsRaw.trim() !== '' && row.argsRaw.trim() !== '{}') return true
  if (row.call !== undefined) return true
  if (asRecord(row.function)?.name !== undefined) return true
  if (row.input !== undefined && (
    (typeof row.name === 'string' && row.name.trim() !== '')
    || (typeof row.toolName === 'string' && row.toolName.trim() !== '')
  )) return true
  return false
}

export function resolveCallId(row: Record<string, unknown>): string | undefined {
  for (const key of CALL_ID_KEYS) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  const call = asRecord(row.call)
  if (call !== null) {
    for (const key of CALL_ID_KEYS) {
      const value = call[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  const fn = asRecord(row.function)
  if (typeof fn?.id === 'string' && fn.id.trim() !== '') return fn.id.trim()
  if (typeof row.id === 'string' && row.id.trim() !== '' && hasToolShape(row)) return row.id.trim()
  return undefined
}

export function resolveToolName(row: Record<string, unknown>): string | undefined {
  if (typeof row.toolName === 'string' && row.toolName.trim() !== '') return row.toolName.trim()
  const fn = asRecord(row.function)
  if (typeof fn?.name === 'string' && fn.name.trim() !== '') return fn.name.trim()
  const call = asRecord(row.call)
  if (typeof call?.toolName === 'string' && call.toolName.trim() !== '') return call.toolName.trim()
  if (typeof call?.name === 'string' && call.name.trim() !== '') return call.name.trim()
  if (hasToolShape(row) && typeof row.name === 'string' && row.name.trim() !== '') return row.name.trim()
  return undefined
}

function readStringField(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '' && !isEmptyArgsRaw(value)) return value.trim()
  }
  return undefined
}

function readObjectArgs(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (value === undefined || value === null) continue
    const raw = argsToRaw(value)
    if (!isEmptyArgsRaw(raw)) return raw
  }
  return undefined
}

/** 从单行会话数据抽取工具参数 JSON 文本。 */
export function resolveArgsRaw(row: Record<string, unknown>): string {
  const direct = readStringField(row, ['argsRaw', 'args_raw', 'argumentsRaw', 'arguments'])
  if (direct !== undefined) return direct

  const call = asRecord(row.call)
  if (call !== null) {
    const fromCall = readStringField(call, ['argsRaw', 'args_raw', 'arguments'])
      ?? readObjectArgs(call, ['input', 'args', 'arguments', 'parameters', 'params'])
    if (fromCall !== undefined) return fromCall
  }

  const fn = asRecord(row.function)
  if (fn?.arguments !== undefined) {
    const fromFn = argsToRaw(fn.arguments)
    if (!isEmptyArgsRaw(fromFn)) return fromFn
  }

  const fromObject = readObjectArgs(row, ['input', 'args', 'arguments', 'parameters', 'params', 'payload'])
  if (fromObject !== undefined) return fromObject

  const present = asRecord(row.present) ?? asRecord(row.card) ?? asRecord(row.view)
  if (present !== null) {
    const fromPresent = argsToRaw(present)
    if (!isEmptyArgsRaw(fromPresent)) return fromPresent
  }

  const shellHint = readStringField(row, ['command', 'cmd', 'script', 'code'])
  if (shellHint !== undefined) {
    return argsToRaw({
      command: row.command ?? row.cmd,
      script: row.script,
      code: row.code,
      language: row.language,
      cwd: row.cwd,
      description: row.description,
    })
  }

  return '{}'
}

export function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const row = asRecord(item)
    if (row === null) continue
    if (row.type === 'text' && typeof row.text === 'string') {
      parts.push(row.text)
      continue
    }
    if (typeof row.text === 'string') parts.push(row.text)
    else if (typeof row.value === 'string') parts.push(row.value)
  }
  return parts.join('\n')
}

export function resolveResultRaw(row: Record<string, unknown>): string | undefined {
  const fromContent = blockText(row.content)
  if (fromContent.trim() !== '') return fromContent
  if (typeof row.result === 'string' && row.result.trim() !== '') return row.result
  if (typeof row.output === 'string' && row.output.trim() !== '') return row.output
  const fromResult = blockText(row.result)
  if (fromResult.trim() !== '') return fromResult
  const fromOutput = blockText(row.output)
  if (fromOutput.trim() !== '') return fromOutput
  return undefined
}
