import { redactSecrets } from './redact.ts'

export const MAX_BLACKLIST_RULES = 40
export const MAX_BLACKLIST_PATTERN = 80

export type BlacklistKind = 'rm' | 'other'

export type BlacklistRule = {
  id: string
  kind: BlacklistKind
  enabled: boolean
  pattern: string
}

export const DEFAULT_BLACKLIST: readonly BlacklistRule[] = [
  { id: 'rm-rf', kind: 'rm', enabled: true, pattern: 'rm -rf' },
  { id: 'mkfs', kind: 'other', enabled: true, pattern: 'mkfs' },
  { id: 'dd-of', kind: 'other', enabled: true, pattern: 'dd of=' },
  { id: 'fork-bomb', kind: 'other', enabled: true, pattern: ':(){' },
  { id: 'write-sd', kind: 'other', enabled: true, pattern: '>/dev/sd' },
  { id: 'shutdown', kind: 'other', enabled: true, pattern: 'shutdown' },
  { id: 'reboot', kind: 'other', enabled: true, pattern: 'reboot' },
  { id: 'halt', kind: 'other', enabled: true, pattern: 'halt' },
  { id: 'poweroff', kind: 'other', enabled: true, pattern: 'poweroff' },
  { id: 'init-0', kind: 'other', enabled: true, pattern: 'init 0' },
  { id: 'init-6', kind: 'other', enabled: true, pattern: 'init 6' },
  { id: 'git-reset-hard', kind: 'other', enabled: true, pattern: 'git reset --hard' },
  { id: 'git-clean-f', kind: 'other', enabled: true, pattern: 'git clean -f' },
  { id: 'find-delete', kind: 'other', enabled: true, pattern: 'find -delete' },
  { id: 'format-drive', kind: 'other', enabled: true, pattern: 'format' },
]

const LEGACY_RULE_TO_IDS: Record<string, readonly string[]> = {
  rmRf: ['rm-rf'],
  mkfs: ['mkfs'],
  ddDisk: ['dd-of'],
  forkBomb: ['fork-bomb'],
  writeDisk: ['write-sd'],
  shutdown: ['shutdown', 'reboot', 'halt', 'poweroff', 'init-0', 'init-6'],
  formatDrive: ['format-drive'],
  gitResetHard: ['git-reset-hard'],
  gitClean: ['git-clean-f'],
  findDelete: ['find-delete'],
}

export function createBlacklistRule(kind: BlacklistKind, pattern = ''): BlacklistRule {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id: `${kind}-${stamp}`,
    kind,
    enabled: true,
    pattern,
  }
}

export function cloneBlacklist(rules: readonly BlacklistRule[]): BlacklistRule[] {
  return rules.map(rule => ({ ...rule }))
}

export function resolveBlacklistPattern(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = redactSecrets(raw.replace(/[\r\n]+/g, ' ').trim())
  return text.length > MAX_BLACKLIST_PATTERN ? text.slice(0, MAX_BLACKLIST_PATTERN) : text
}

function resolveKind(raw: unknown, pattern: string): BlacklistKind {
  if (raw === 'rm' || raw === 'other') return raw
  const stripped = pattern.replace(/^sudo\s+/i, '')
  return /^rm\b/i.test(stripped) ? 'rm' : 'other'
}

export function resolveBlacklistRule(raw: unknown, index: number): BlacklistRule | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const pattern = typeof source.pattern === 'string' ? source.pattern.replace(/[\r\n]+/g, ' ') : ''
  const clipped = pattern.length > MAX_BLACKLIST_PATTERN ? pattern.slice(0, MAX_BLACKLIST_PATTERN) : pattern
  const kind = resolveKind(source.kind, clipped.trim())
  const id = typeof source.id === 'string' && source.id.trim() !== ''
    ? source.id.trim().slice(0, 64)
    : `${kind}-${index}`
  return {
    id,
    kind,
    enabled: source.enabled !== false,
    pattern: clipped,
  }
}

export function resolveBlacklist(raw: unknown, legacyRules?: unknown): BlacklistRule[] {
  if (Array.isArray(raw)) {
    const next: BlacklistRule[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      if (next.length >= MAX_BLACKLIST_RULES) break
      const rule = resolveBlacklistRule(item, next.length)
      if (rule === null) continue
      let id = rule.id
      if (seen.has(id)) id = `${id}-${next.length}`
      seen.add(id)
      next.push({ ...rule, id })
    }
    return next
  }
  if (legacyRules !== null && typeof legacyRules === 'object' && !Array.isArray(legacyRules)) {
    const flags = legacyRules as Record<string, unknown>
    return DEFAULT_BLACKLIST.map(rule => {
      let enabled = rule.enabled
      for (const [legacy, ids] of Object.entries(LEGACY_RULE_TO_IDS)) {
        if (ids.includes(rule.id) && typeof flags[legacy] === 'boolean') {
          enabled = flags[legacy]
          break
        }
      }
      return { ...rule, enabled }
    })
  }
  return cloneBlacklist(DEFAULT_BLACKLIST)
}

export function blacklistEqual(a: readonly BlacklistRule[], b: readonly BlacklistRule[]): boolean {
  if (a.length !== b.length) return false
  return a.every((rule, index) => {
    const other = b[index]
    return other !== undefined
      && rule.id === other.id
      && rule.kind === other.kind
      && rule.enabled === other.enabled
      && rule.pattern === other.pattern
  })
}

type RmNeed = {
  recursive: boolean
  force: boolean
  extraFlags: string
  paths: string[]
  anyRm: boolean
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function stripSudo(tokens: string[]): string[] {
  if (tokens[0]?.toLowerCase() === 'sudo') return tokens.slice(1)
  return tokens
}

function parseRmNeed(pattern: string): RmNeed | null {
  const tokens = stripSudo(tokenize(pattern))
  if (tokens.length === 0 || tokens[0]?.toLowerCase() !== 'rm') return null
  let recursive = false
  let force = false
  let extraFlags = ''
  const paths: string[] = []
  for (const token of tokens.slice(1)) {
    if (token === '--') continue
    if (token === '--recursive' || token.startsWith('--recursive=')) {
      recursive = true
      continue
    }
    if (token === '--force' || token.startsWith('--force=')) {
      force = true
      continue
    }
    if (token.startsWith('--')) continue
    if (/^-[A-Za-z]+$/.test(token)) {
      if (/[rR]/.test(token)) recursive = true
      if (/f/.test(token)) force = true
      extraFlags += token.slice(1).replace(/[rRf]/g, '')
      continue
    }
    paths.push(token)
  }
  return {
    recursive,
    force,
    extraFlags: extraFlags.toLowerCase(),
    paths,
    anyRm: !recursive && !force && extraFlags === '' && paths.length === 0,
  }
}

function shortFlagsIn(tokens: string[]): string {
  let flags = ''
  for (const token of tokens) {
    if (token === '--') break
    if (token.startsWith('--')) {
      if (token === '--recursive' || token.startsWith('--recursive=')) flags += 'r'
      if (token === '--force' || token.startsWith('--force=')) flags += 'f'
      continue
    }
    if (/^-[A-Za-z]+$/.test(token)) flags += token.slice(1).toLowerCase()
  }
  return flags
}

function rmInvocations(command: string): string[][] {
  const chunks = command.split(/[|;&\n]+/)
  const found: string[][] = []
  for (const chunk of chunks) {
    const tokens = stripSudo(tokenize(chunk.replace(/^\s*\(+/, '')))
    const index = tokens.findIndex(token => token.toLowerCase() === 'rm')
    if (index === -1) continue
    found.push(tokens.slice(index + 1))
  }
  return found
}

function rmMatchesNeed(args: string[], need: RmNeed): boolean {
  if (need.anyRm) return true
  const flags = shortFlagsIn(args)
  if (need.recursive && !flags.includes('r')) return false
  if (need.force && !flags.includes('f')) return false
  for (const letter of need.extraFlags) {
    if (!flags.includes(letter)) return false
  }
  const paths = []
  for (const token of args) {
    if (token === '--') continue
    if (token.startsWith('-') && token !== '-') continue
    paths.push(token)
  }
  for (const required of need.paths) {
    const hit = paths.some(path => {
      if (required === '/') return path === '/' || path === '/*'
      return path === required || path.startsWith(`${required}/`)
    })
    if (!hit) return false
  }
  return true
}

function commandMatchesRm(command: string, pattern: string): boolean {
  const effective = pattern.trim().replace(/^sudo\s+/i, '')
  const withRm = /^rm\b/i.test(effective) ? pattern.trim() : `rm ${effective}`
  const need = parseRmNeed(withRm)
  if (need === null) return false
  return rmInvocations(command).some(args => rmMatchesNeed(args, need))
}

function shortFlagPresent(tokens: string[], letter: string): boolean {
  const lower = letter.toLowerCase()
  for (const token of tokens) {
    if (token === '--') break
    if (/^-[A-Za-z]+$/.test(token) && token.toLowerCase().includes(lower)) return true
  }
  return false
}

function commandHasToken(command: string, token: string): boolean {
  const needle = token.toLowerCase()
  if (needle === '') return false
  const words = tokenize(command)
  if (needle.startsWith('--')) {
    return words.some(word => {
      const lower = word.toLowerCase()
      return lower === needle || lower.startsWith(`${needle}=`)
    })
  }
  if (/^-[A-Za-z]{1,3}$/.test(token)) {
    return [...token.slice(1)].every(letter => shortFlagPresent(words, letter))
  }
  if (/[/=><:{]/.test(token)) {
    return command.toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
  }
  if (/^[A-Za-z][\w]*$/.test(token)) {
    return words.some(word => {
      const lower = word.toLowerCase()
      return lower === needle || lower.startsWith(`${needle}.`)
    })
  }
  return words.some(word => word.toLowerCase() === needle)
}

function commandMatchesOther(command: string, pattern: string): boolean {
  const tokens = tokenize(pattern)
  if (tokens.length === 0) return false
  return tokens.every(token => commandHasToken(command, token))
}

/** True when an enabled blacklist rule matches this command line. */
export function commandMatchesBlacklist(command: string, rules: readonly BlacklistRule[]): boolean {
  const text = command.trim()
  if (text === '') return false
  for (const rule of rules) {
    if (!rule.enabled) continue
    const pattern = rule.pattern.trim()
    if (pattern === '') continue
    if (rule.kind === 'rm') {
      if (commandMatchesRm(text, pattern)) return true
      continue
    }
    if (commandMatchesOther(text, pattern)) return true
  }
  return false
}

export function isRmBlacklistPattern(pattern: string): boolean {
  return /^sudo\s+/i.test(pattern.trim())
    ? /^sudo\s+rm\b/i.test(pattern.trim())
    : /^rm\b/i.test(pattern.trim())
}
