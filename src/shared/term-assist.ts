import { redactSecrets } from './redact.ts'
import { commandMatchesBlacklist } from './term-assist-blacklist.ts'
import {
  DEFAULT_TERM_ASSIST_PREFS,
  DEFAULT_TERM_ASSIST_SEPARATOR,
  resolveTermAssistPrefs,
  type TermAssistPrefs,
} from './term-assist-prefs.ts'

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
/** English glue words: `sort by disk usage` is a request, not `sort(1)` argv. */
const PROSE_WORD = /^(a|an|the|this|that|these|those|my|all|by|of|from|into|onto|with|using|and|or|to|in|on|for|per|vs|versus|current|directory|folder|files?|lines?|disk|usage|size|largest|smallest|desc|asc|ascending|descending|please)$/i
const ARGV_TOKEN = /^(?:-{1,2}[\w.-]+|[.~]?\/\S*|\S+\.\w+|\d+|[A-Za-z0-9._*+[\]%@:=,-]+)$/

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

function restLooksLikeArgv(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return true
  if (/[|;&><]/.test(text)) return true
  const token = firstToken(text)
  if (token === 'echo' || token === 'printf') return true
  const rest = words.slice(1)
  if (rest.some(word => PROSE_WORD.test(word))) return false
  if (CJK.test(text)) return false
  return rest.every(word => ARGV_TOKEN.test(word))
}

/**
 * Heuristic: a real argv line goes straight to the PTY.
 * Anything that reads as a request is sent to the model.
 * First-token allowlist is not enough: `sort by disk usage` starts with `sort`
 * but is English, not `sort(1)` flags.
 */
export function classifyTermAssistInput(raw: string): TermAssistKind {
  const text = stripTermPrompt(raw)
  if (text === '') return 'ask'
  if (isQuestion(text)) return 'ask'
  const token = firstToken(text)
  const known = KNOWN_SHELL_COMMANDS.has(token) || token.endsWith('.sh') || token.endsWith('.bash')
  if (CJK.test(text) && !known) return 'ask'
  if (known) return restLooksLikeArgv(text) ? 'run' : 'ask'
  if (PATH_START.test(text) || ENV_ASSIGN.test(text)) return 'run'
  return 'ask'
}

export function looksLikeShellCommand(raw: string): boolean {
  return classifyTermAssistInput(raw) === 'run'
}

/**
 * Hard veto when an enabled blacklist rule matches.
 * Ordinary `rm file` is not blocked unless the user adds a rule for it.
 */
export function looksDestructiveCommand(command: string, prefs?: unknown): boolean {
  const text = command.trim()
  if (text === '') return false
  const p = resolveTermAssistPrefs(prefs)
  if (!p.blockDestructive) return false
  return commandMatchesBlacklist(text, p.blacklist)
}

/** Chinese PTY note when assist refuses a destructive command. Secrets already redacted. */
export function destructiveAssistNote(command: string): string {
  const shown = redactSecrets(command.trim().replace(/\s+/g, ' '))
  const clip = shown.length > 160 ? `${shown.slice(0, 159)}…` : shown
  return [
    '已拒绝执行：命令命中助手黑名单，AI 助手不会代为执行，以免误删文件或系统。',
    clip === '' ? '' : `拦截：${clip}`,
    '如确需操作，请在下方终端自行核对路径后手动输入。黑名单可在齿轮设置里增删。',
  ].filter(line => line !== '').join('\n')
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

export function parseAssistOutput(raw: string, prefs?: unknown): AssistVerdict {
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
  if (looksDestructiveCommand(command, prefs)) {
    return { kind: 'ask', note: destructiveAssistNote(command) }
  }
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

/** Default divider text. Override via prefs.separatorText. */
export const TERM_ASSIST_META_SEPARATOR = DEFAULT_TERM_ASSIST_SEPARATOR

function resolvedPrefs(prefs?: unknown): TermAssistPrefs {
  return prefs === undefined ? DEFAULT_TERM_ASSIST_PREFS : resolveTermAssistPrefs(prefs)
}

/** Clear the current line, then optionally a no-op separator. Not produced by the model. */
export function termAssistLeadIn(shell = '', prefs?: unknown): string {
  const p = resolvedPrefs(prefs)
  if (!p.showSeparator) return '\x15'
  return `\x15\r${termAssistNoopCommand(p.separatorText, shell)}\r`
}

/** Model-translated runs: optional separator, optional explain line, then the command. */
export function termAssistRunPayload(command: string, explain = '', shell = '', prefs?: unknown): string {
  const p = resolvedPrefs(prefs)
  const rawExplain = clipAssistExplain(explain)
  const note = p.showExplain ? rawExplain : ''
  const modelTurn = rawExplain !== ''
  if (note === '' && !(p.showSeparator && modelTurn)) return termAssistPayload(command)
  const prefix = termAssistLeadIn(shell, p)
  if (note === '') return `${prefix}${command}\r`
  return `${prefix}${termAssistNoopCommand(note, shell)}\r${command}\r`
}

/** Non-executable replies: optional separator, then quoted no-ops. */
export function termAssistCommentPayload(note: string, shell = '', prefs?: unknown): string {
  const p = resolvedPrefs(prefs)
  const lines = clipAssistInput(redactSecrets(note))
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line !== '')
    .slice(0, 8)
    .map(line => termAssistNoopCommand(line, shell))
  const body = lines.length === 0 ? `${termAssistNoopCommand('#', shell)}\r` : `${lines.join('\r')}\r`
  return `${termAssistLeadIn(shell, p)}${body}`
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
