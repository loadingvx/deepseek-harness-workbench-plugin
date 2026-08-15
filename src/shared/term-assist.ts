import { redactSecrets } from './redact.ts'

export const MAX_TERM_ASSIST_INPUT = 4_000
export const MAX_TERM_ASSIST_TRANSCRIPT = 6_000

/** Common argv0 tokens. Keep lowercase; matching is case-insensitive. */
export const KNOWN_SHELL_COMMANDS: ReadonlySet<string> = new Set([
  '.', 'alias', 'ansible', 'apt', 'awk', 'bash', 'brew', 'bun', 'cargo', 'cat',
  'cd', 'chmod', 'chown', 'clang', 'clear', 'cmake', 'code', 'column', 'cp',
  'curl', 'cut', 'date', 'deno', 'df', 'diff', 'dig', 'dnf', 'docker', 'dsh', 'du',
  'echo', 'env', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fd', 'find',
  'free', 'fzf', 'gcc', 'gh',
  'git', 'go', 'grep', 'head', 'helm', 'help', 'history', 'htop', 'id', 'ip', 'java',
  'journalctl', 'jq', 'kill', 'killall', 'kubectl', 'less', 'ln', 'ls', 'lsof',
  'make', 'man', 'mise', 'mkdir', 'more', 'mount', 'mv', 'mvn', 'mysql', 'nano',
  'netstat', 'node', 'nohup', 'npm', 'npx', 'nslookup', 'nvim', 'pacman', 'ping',
  'pipx', 'bunx',
  'pip', 'pip3', 'pnpm', 'podman', 'printenv', 'printf', 'ps', 'psql', 'pwd',
  'python', 'python3', 'rg', 'rm', 'rsync', 'rustc', 'scp', 'screen', 'sed',
  'set', 'sh', 'shift', 'sleep', 'sort', 'source', 'ss', 'ssh', 'stat',
  'sudo', 'systemctl', 'tail', 'tar', 'tee', 'terraform', 'time', 'timeout',
  'tmux', 'top', 'touch', 'tr', 'traceroute', 'tree', 'true', 'type', 'ulimit',
  'umask', 'uname', 'uniq', 'unzip', 'uv', 'vim', 'wait', 'watch', 'wc', 'wget',
  'which', 'whoami', 'xargs', 'yarn', 'yum', 'zip', 'zsh',
])

const ASK_EN = /^(please|pls|plz|can you|could you|would you|how (?:do|can|to|would)|what(?:'s| is| are)?|why\b|where\b|who\b|help me\b|i (?:want|need|would)|show me\b|tell me\b|explain\b|list all\b|list the\b)/i
const ASK_CJK = /(请帮|帮我|帮忙|怎么|如何|为何|为什么|什么是|看看|看一下|解释一下|告诉我|我想|我要|能否|可不可以|麻烦|帮下|求助)/
const CJK = /[\u3400-\u9fff]/
const PROMPT_PREFIX = /^(?:[>$%❯➜]\s+|PS\s*>\s+)/
const HASH_PROMPT = /^#\s+/
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const PATH_START = /^(?:\.\.?\/|~\/|\/)/
const ASK_LINE = /^(?:ASK|NOTE|说明)\s*[:：]\s*/i
const GREETING = /^(hi|hey|hello|hola|yo|thanks|thank you|thx|ok|okay|bye|goodbye|你好|您好|嗨|谢谢|感谢|再见)(?:[\s!.。！？?,，~～].*)?$/i

export type TermAssistKind = 'run' | 'ask'

export type AssistVerdict =
  | { kind: 'command'; command: string; explain: string }
  | { kind: 'ask'; note: string }
  | { kind: 'empty' }

export const MAX_TERM_ASSIST_EXPLAIN = 80

/** Strip a pasted prompt character so ` $ ls` still counts as a command. */
export function stripTermPrompt(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  text = stripPromptPrefix(text)
  if ((text.startsWith('`') && text.endsWith('`')) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1).trim()
  }
  return text
}

function stripPromptPrefix(text: string): string {
  const stripped = text.replace(PROMPT_PREFIX, '')
  if (stripped !== text) return stripped
  if (!text.includes('\n') && HASH_PROMPT.test(text)) return text.replace(HASH_PROMPT, '')
  return text
}

function firstToken(text: string): string {
  const token = text.split(/[\s;|&<>]+/, 1)[0] ?? ''
  return token.replace(/^\(+/, '').toLowerCase()
}

function isQuestion(text: string): boolean {
  if (ASK_EN.test(text) || ASK_CJK.test(text)) return true
  if (text.includes('？')) return true
  if (/\?\s*$/.test(text) && !text.startsWith('[')) return true
  return false
}

/**
 * Heuristic: a real argv line goes straight to the PTY.
 * Anything that reads as a request is sent to the model.
 */
export function classifyTermAssistInput(raw: string): TermAssistKind {
  const text = stripTermPrompt(raw)
  if (text === '') return 'ask'
  if (isQuestion(text)) return 'ask'
  const token = firstToken(text)
  const known = KNOWN_SHELL_COMMANDS.has(token) || token.endsWith('.sh') || token.endsWith('.bash')
  if (CJK.test(text) && !known) return 'ask'
  if (known) return 'run'
  if (PATH_START.test(text) || ENV_ASSIGN.test(text)) return 'run'
  return 'ask'
}

export function looksLikeShellCommand(raw: string): boolean {
  return classifyTermAssistInput(raw) === 'run'
}

/** LLM-proposed commands that must not auto-run. User-typed commands still go through. */
export function looksDestructiveCommand(command: string): boolean {
  const text = command.trim()
  if (text === '') return false
  if (/\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)/i.test(text)) return true
  if (/\brm\s+.*--recursive\b/i.test(text) && /\b--force\b/i.test(text)) return true
  if (/\bmkfs(\.\w+)?\b/i.test(text)) return true
  if (/\bdd\b[\s\S]*\bof=/i.test(text)) return true
  if (/:\(\)\s*\{/.test(text)) return true
  if (/>\s*\/dev\/sd/i.test(text)) return true
  if (/\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i.test(text)) return true
  if (/\bformat\s+[a-z]:/i.test(text)) return true
  return false
}

export function sanitizeAssistCommand(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  const fenced = /^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/m.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, '').replace(/\n```[ \t]*$/, '').trim()
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim()
  text = stripPromptPrefix(text)
  if (text.length > MAX_TERM_ASSIST_INPUT) text = text.slice(0, MAX_TERM_ASSIST_INPUT).trim()
  return text
}

/** Live preview: hide unfinished fences so the bar fills with real words. */
export function previewAssistText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  text = text.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, '')
  text = text.replace(/\n```[ \t]*$/, '')
  text = stripPromptPrefix(text)
  if (text.length > MAX_TERM_ASSIST_INPUT) text = text.slice(0, MAX_TERM_ASSIST_INPUT)
  return text
}

function stripAskPrefix(text: string): string {
  return text.replace(ASK_LINE, '').trim()
}

function unwrapSpokenEcho(command: string): string | null {
  const m = /^(echo|printf)\s+(?:-[nEe]+\s+)*(.*)$/.exec(command.trim())
  if (m === null) return null
  if (m[1] === 'printf' && /%[a-zA-Z]/.test(command)) return null
  const rest = m[2].trim()
  if (rest === '' || /[;|&<>`$()]/.test(rest)) return null
  const unquoted = rest.replace(/^(['"])([\s\S]*)\1$/, '$2')
  if (GREETING.test(unquoted)) return unquoted
  if (/\s/.test(unquoted) && /[A-Za-z\u3400-\u9fff]/.test(unquoted) && !unquoted.startsWith('-')) {
    return unquoted
  }
  return null
}

function isSpokenReply(text: string): boolean {
  if (GREETING.test(text)) return true
  if (ASK_EN.test(text) || ASK_CJK.test(text)) return true
  if (/[.!?。！？]/.test(text) && text.split(/\s+/).length >= 3) return true
  return false
}

/**
 * Model output: known argv / path / env assignment → command.
 * Greetings, prose, and lone unknown tokens → comment (never executed).
 */
export function looksLikeModelCommand(text: string): boolean {
  if (classifyTermAssistInput(text) === 'run') {
    return unwrapSpokenEcho(text) === null
  }
  if (isSpokenReply(text) || unwrapSpokenEcho(text) !== null) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return false
  if (CJK.test(text)) return false
  return /^[A-Za-z0-9._+-]+(\s+(-{1,2}[\w.-]+|\S+))*$/.test(text) && words.length <= 8
}

export function parseAssistOutput(raw: string): AssistVerdict {
  const text = sanitizeAssistCommand(raw)
  if (text === '') return { kind: 'empty' }
  if (ASK_LINE.test(text)) {
    const note = stripAskPrefix(text)
    return { kind: 'ask', note: note === '' ? text : note }
  }
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  const comments: string[] = []
  let commandLine: string | undefined
  for (const line of lines) {
    if (commandLine === undefined && line.startsWith('#')) {
      const body = line.replace(/^\s*#+\s?/, '').trim()
      if (body !== '') comments.push(body)
      continue
    }
    if (commandLine === undefined) {
      commandLine = line
      continue
    }
    break
  }
  const explain = comments[0] ?? ''
  if (commandLine === undefined) {
    if (comments.length === 0) return { kind: 'empty' }
    return { kind: 'ask', note: comments.join('\n') }
  }
  if (ASK_LINE.test(commandLine)) {
    const note = stripAskPrefix(commandLine)
    return { kind: 'ask', note: note === '' ? commandLine : note }
  }
  const command = commandLine.replace(PROMPT_PREFIX, '').trim()
  if (command === '') return { kind: 'empty' }
  const spoken = unwrapSpokenEcho(command)
  if (spoken !== null) return { kind: 'ask', note: spoken }
  if (looksLikeModelCommand(command)) return { kind: 'command', command, explain }
  if (comments.length > 0) return { kind: 'ask', note: [...comments, command].join('\n') }
  return { kind: 'ask', note: text }
}

export function clipAssistInput(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim()
  return text.length > MAX_TERM_ASSIST_INPUT ? text.slice(0, MAX_TERM_ASSIST_INPUT) : text
}

export function clipAssistTranscript(raw: string): string {
  const text = redactSecrets(raw.replace(/\r\n/g, '\n').trim())
  if (text.length <= MAX_TERM_ASSIST_TRANSCRIPT) return text
  return text.slice(text.length - MAX_TERM_ASSIST_TRANSCRIPT)
}

export function buildTermAssistUserPrompt(input: {
  text: string
  cwd?: string
  transcript?: string
}): string {
  const parts = ['请根据下面的用户输入给出命令或 ASK 说明。']
  if (input.cwd !== undefined && input.cwd !== '') {
    parts.push('', `工作目录：${input.cwd}`)
  }
  const transcript = input.transcript === undefined ? '' : clipAssistTranscript(input.transcript)
  if (transcript !== '') {
    parts.push('', '最近终端输出：', transcript)
  }
  parts.push('', '用户输入：', clipAssistInput(input.text))
  return parts.join('\n')
}

/** One-line, redacted comment body for the PTY. */
export function clipAssistExplain(raw: string): string {
  const text = redactSecrets(raw.replace(/\r\n/g, '\n'))
    .split('\n')
    .map(line => line.replace(/^\s*#+\s?/, '').trim())
    .find(line => line !== '') ?? ''
  if (text.length <= MAX_TERM_ASSIST_EXPLAIN) return text
  return `${text.slice(0, MAX_TERM_ASSIST_EXPLAIN - 1).trimEnd()}…`
}

/** Prefer the model summary; if missing, fall back to the original user text. */
export function resolveAssistExplain(explain: string, userText: string): string {
  const fromModel = clipAssistExplain(explain)
  if (fromModel !== '') return fromModel
  return clipAssistExplain(userText)
}

/** Quote so bash / zsh / sh / dash will not glob (`?` `*`) or hist-expand (`!`). */
export function quoteShellArg(raw: string): string {
  return raw.split('!').map(part => `'${part.replace(/'/g, `'\\''`)}'`).join('\\!')
}

/**
 * Visible `# …` line that does not run.
 * Bare `#` is not a comment in interactive zsh, and bash still hist-expands `!`
 * before parsing a `#` comment. POSIX `:` ignores a quoted argument in bash/zsh/sh/dash.
 */
export function termAssistNoopCommand(comment: string, shell = ''): string {
  void shell
  const cleaned = comment.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/^\s*#+\s?/, '').trim()
  const line = cleaned === '' ? '#' : `# ${cleaned}`
  return `: ${quoteShellArg(line)}`
}

/** Bytes to type into the PTY: clear the current line, then run the command. */
export function termAssistPayload(command: string): string {
  return `\x15${command}\r`
}

/** Hardcoded divider so each assist turn is visually split from the last command. */
export const TERM_ASSIST_META_SEPARATOR = '--------'

/** Empty prompt line + a no-op separator. Not produced by the model. */
export function termAssistLeadIn(shell = ''): string {
  return `\x15\r${termAssistNoopCommand(TERM_ASSIST_META_SEPARATOR, shell)}\r`
}

/** Model-translated runs: blank + separator, explain line, then the command. */
export function termAssistRunPayload(command: string, explain = '', shell = ''): string {
  const note = clipAssistExplain(explain)
  if (note === '') return termAssistPayload(command)
  return `${termAssistLeadIn(shell)}${termAssistNoopCommand(note, shell)}\r${command}\r`
}

/** Non-executable replies: blank + separator, then quoted no-ops. */
export function termAssistCommentPayload(note: string, shell = ''): string {
  const lines = clipAssistInput(redactSecrets(note))
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line !== '')
    .slice(0, 8)
    .map(line => termAssistNoopCommand(line, shell))
  const body = lines.length === 0 ? `${termAssistNoopCommand('#', shell)}\r` : `${lines.join('\r')}\r`
  return `${termAssistLeadIn(shell)}${body}`
}

export function isTermAssistHotkey(event: {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  code: string
  isComposing?: boolean
  repeat?: boolean
}): boolean {
  if (event.isComposing === true || event.repeat === true) return false
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyI'
}
