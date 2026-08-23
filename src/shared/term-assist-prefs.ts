import { redactSecrets } from './redact.ts'
import {
  blacklistEqual,
  cloneBlacklist,
  DEFAULT_BLACKLIST,
  resolveBlacklist,
  type BlacklistRule,
} from './term-assist-blacklist.ts'

export const DEFAULT_TERM_ASSIST_SEPARATOR = '--------'
export const MAX_TERM_ASSIST_SEPARATOR = 80

export type TermAssistPrefs = {
  /** Insert the visual divider (`: '# --------'`) before assist output. */
  showSeparator: boolean
  /** Divider body. Empty / oversized input falls back to the default dashes. */
  separatorText: string
  /** Write the model one-line summary as a no-op comment before the command. */
  showExplain: boolean
  /** Known argv (`ls`, `git status`) goes straight to the PTY. Off → always ask the model. */
  directRunKnownCommands: boolean
  /** Master switch for the command blacklist. */
  blockDestructive: boolean
  /** Editable deny-list. `rm` rules use flag-aware matching. */
  blacklist: BlacklistRule[]
}

export const DEFAULT_TERM_ASSIST_PREFS: TermAssistPrefs = {
  showSeparator: true,
  separatorText: DEFAULT_TERM_ASSIST_SEPARATOR,
  showExplain: true,
  directRunKnownCommands: true,
  blockDestructive: true,
  blacklist: cloneBlacklist(DEFAULT_BLACKLIST),
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function resolveSeparatorText(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_TERM_ASSIST_SEPARATOR
  const text = redactSecrets(raw.replace(/[\r\n]+/g, ' ').trim())
  if (text === '') return DEFAULT_TERM_ASSIST_SEPARATOR
  return text.length > MAX_TERM_ASSIST_SEPARATOR ? text.slice(0, MAX_TERM_ASSIST_SEPARATOR) : text
}

/** Accepts stored JSON, a host POST body, or a partial draft. Always returns a complete prefs object. */
export function resolveTermAssistPrefs(raw: unknown): TermAssistPrefs {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS)
  }
  const source = raw as Record<string, unknown>
  return {
    showSeparator: asBool(source.showSeparator, DEFAULT_TERM_ASSIST_PREFS.showSeparator),
    separatorText: resolveSeparatorText(source.separatorText),
    showExplain: asBool(source.showExplain, DEFAULT_TERM_ASSIST_PREFS.showExplain),
    directRunKnownCommands: asBool(
      source.directRunKnownCommands,
      DEFAULT_TERM_ASSIST_PREFS.directRunKnownCommands,
    ),
    blockDestructive: asBool(source.blockDestructive, DEFAULT_TERM_ASSIST_PREFS.blockDestructive),
    blacklist: resolveBlacklist(source.blacklist, source.destructiveRules),
  }
}

export function cloneTermAssistPrefs(prefs: TermAssistPrefs): TermAssistPrefs {
  return {
    showSeparator: prefs.showSeparator,
    separatorText: prefs.separatorText,
    showExplain: prefs.showExplain,
    directRunKnownCommands: prefs.directRunKnownCommands,
    blockDestructive: prefs.blockDestructive,
    blacklist: cloneBlacklist(prefs.blacklist),
  }
}

export function termAssistPrefsEqual(a: TermAssistPrefs, b: TermAssistPrefs): boolean {
  if (
    a.showSeparator !== b.showSeparator
    || a.separatorText !== b.separatorText
    || a.showExplain !== b.showExplain
    || a.directRunKnownCommands !== b.directRunKnownCommands
    || a.blockDestructive !== b.blockDestructive
  ) return false
  return blacklistEqual(a.blacklist, b.blacklist)
}

export function isDefaultTermAssistPrefs(prefs: TermAssistPrefs): boolean {
  return termAssistPrefsEqual(prefs, DEFAULT_TERM_ASSIST_PREFS)
}

export function parseStoredTermAssistPrefs(raw: string | null): TermAssistPrefs {
  if (raw === null || raw.trim() === '') return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS)
  try {
    return resolveTermAssistPrefs(JSON.parse(raw) as unknown)
  } catch {
    return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS)
  }
}
