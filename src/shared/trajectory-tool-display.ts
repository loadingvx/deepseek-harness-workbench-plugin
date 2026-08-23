/**
 * 将工具调用格式化为用户可读标题与 I/O 文本。
 * run_code / Shell 等优先展示具体命令，而非工具注册名。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseArgs(argsRaw: string): Record<string, unknown> | null {
  const trimmed = argsRaw.trim()
  if (trimmed === '') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return asRecord(parsed)
  } catch {
    return null
  }
}

function firstLine(text: string, max = 96): string {
  const line = text.replace(/\s+/g, ' ').trim().split('\n')[0] ?? ''
  if (line.length <= max) return line
  return `${line.slice(0, max - 1)}…`
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (obj === null) return undefined
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function formatInput(obj: Record<string, unknown> | null, fallback: string): string {
  if (obj === null) return fallback
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return fallback
  }
}

export interface ToolDisplayInfo {
  /** 主标题 — 具体命令/路径/模式等 */
  title: string
  /** 次要标签 — 读取/搜索/写入…；run_code 场景通常为空 */
  tag: string
  inputText: string
}

const SHELL_NAMES = new Set([
  'run_code', 'shell', 'bash', 'execute', 'terminal', 'run_terminal_cmd',
])

const READ_NAMES = new Set(['read', 'read_file', 'view', 'cat'])

const WRITE_NAMES = new Set(['write', 'strreplace', 'search_replace', 'edit', 'apply_patch'])

const GREP_NAMES = new Set(['grep', 'rg', 'search'])

const GLOB_NAMES = new Set(['glob', 'glob_file_search', 'file_search'])

export function formatToolDisplay(toolName: string, argsRaw: string): ToolDisplayInfo {
  const lower = toolName.toLowerCase()
  const args = parseArgs(argsRaw)
  const fallbackInput = argsRaw.trim() !== '' ? argsRaw : '{}'

  if (SHELL_NAMES.has(lower)) {
    const command = pickString(args, [
      'command', 'cmd', 'script', 'input', 'code', 'source', 'program', 'stdin',
    ])
      ?? (typeof args?.code === 'string' ? args.code : undefined)
      ?? fallbackInput
    return {
      title: firstLine(command, 120),
      tag: '',
      inputText: command,
    }
  }

  if (READ_NAMES.has(lower)) {
    const path = pickString(args, ['path', 'file', 'file_path', 'target_file']) ?? toolName
    return {
      title: path,
      tag: '读取',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (WRITE_NAMES.has(lower)) {
    const path = pickString(args, ['path', 'file', 'file_path', 'target_file']) ?? toolName
    return {
      title: path,
      tag: '写入',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (GREP_NAMES.has(lower)) {
    const pattern = pickString(args, ['pattern', 'query', 'regex']) ?? '—'
    const path = pickString(args, ['path', 'glob', 'include'])
    return {
      title: path !== undefined ? `${pattern} · ${path}` : pattern,
      tag: '搜索',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (GLOB_NAMES.has(lower)) {
    const pattern = pickString(args, ['pattern', 'glob_pattern', 'query']) ?? '—'
    return {
      title: pattern,
      tag: '匹配',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (lower === 'task' || lower === 'explore') {
    const desc = pickString(args, ['description', 'prompt', 'task']) ?? firstLine(fallbackInput, 80)
    return {
      title: desc,
      tag: '子任务',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (lower === 'todowrite') {
    const todos = Array.isArray(args?.todos) ? args.todos : []
    const titles = todos
      .map(item => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map(item => pickString(item, ['content']) ?? '')
      .filter(Boolean)
      .slice(0, 4)
    return {
      title: titles.length > 0 ? titles.join(' · ') : '更新待办',
      tag: '待办',
      inputText: formatInput(args, fallbackInput),
    }
  }

  if (lower === 'webfetch' || lower === 'fetch') {
    const url = pickString(args, ['url']) ?? firstLine(fallbackInput, 80)
    return {
      title: url,
      tag: '请求',
      inputText: formatInput(args, fallbackInput),
    }
  }

  const generic = pickString(args, ['description', 'query', 'path', 'pattern', 'command'])
  return {
    title: generic ?? toolName,
    tag: toolName,
    inputText: formatInput(args, fallbackInput),
  }
}

export function formatOutputPreview(resultRaw: string | undefined, max = 480): string {
  if (resultRaw === undefined || resultRaw.trim() === '') return ''
  if (resultRaw.length <= max) return resultRaw
  return `${resultRaw.slice(0, max)}\n…（已截断，共 ${resultRaw.length} 字符）`
}
