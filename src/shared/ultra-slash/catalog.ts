/**
 * Builtin and user-defined slash commands owned by this plugin.
 *
 * Host registers them with `ctx.commands`; the client lists them in the
 * ultra-slash `/` group. Custom rows are `/name` aliases of `/steer <text>`.
 */

import type { UltraSlashKey } from './locales.ts'

/** DSH command names: lowercase letter, then letters / digits / _ / -. */
export const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u

export const MAX_CUSTOM_COMMANDS = 40
export const MAX_COMMAND_NAME_LENGTH = 32
export const MAX_DESCRIPTION_LENGTH = 80
export const MAX_STEER_TEXT_LENGTH = 8000

/** One builtin row shown in the ultra-slash group. */
export interface BuiltinSlashCommand {
  readonly name: string
  readonly kind: 'steer' | 'alias' | 'session'
  readonly descriptionKey: UltraSlashKey
  readonly hintKey?: UltraSlashKey
  readonly payloadKey?: UltraSlashKey
}

/** User-defined `/name` → `/steer` payload. */
export interface CustomSlashCommand {
  readonly name: string
  readonly description: string
  readonly steerText: string
}

/** Why a custom-command draft cannot be saved. */
export type CatalogIssue =
  | { readonly code: 'name.empty' }
  | { readonly code: 'name.invalid'; readonly name: string }
  | { readonly code: 'name.tooLong'; readonly name: string; readonly max: number }
  | { readonly code: 'name.reserved'; readonly name: string }
  | { readonly code: 'name.taken'; readonly name: string }
  | { readonly code: 'description.tooLong'; readonly max: number }
  | { readonly code: 'text.empty' }
  | { readonly code: 'text.tooLong'; readonly max: number }
  | { readonly code: 'tooMany'; readonly max: number }
  | { readonly code: 'list.duplicate'; readonly name: string }

/**
 * Shipped commands, in menu order. `/steer` is the primitive; `/skill` and
 * `/docs` are fixed-text aliases of it; `/new` opens a blank session on the client.
 */
export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommand[] = [
  {
    name: 'steer',
    kind: 'steer',
    descriptionKey: 'steer.description',
    hintKey: 'steer.hint',
  },
  {
    name: 'new',
    kind: 'session',
    descriptionKey: 'new.description',
  },
  {
    name: 'skill',
    kind: 'alias',
    descriptionKey: 'skill.description',
    hintKey: 'alias.hint',
    payloadKey: 'skill.payload',
  },
  {
    name: 'docs',
    kind: 'alias',
    descriptionKey: 'docs.description',
    hintKey: 'alias.hint',
    payloadKey: 'docs.payload',
  },
]

export const BUILTIN_SLASH_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_SLASH_COMMANDS.map((command) => command.name),
)

/**
 * Well-known DSH command names we refuse to shadow. A collision with a
 * command that is actually registered is still caught at `commands.register`.
 */
export const DSH_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'help',
  'plan',
  'goal',
  'compact',
  'feedback',
  'export',
  'permission',
  'model',
  'theme',
  'clear',
  'status',
  'commands',
  'resume',
  'fork',
])

export const RESERVED_SLASH_NAMES: ReadonlySet<string> = new Set([
  ...BUILTIN_SLASH_NAMES,
  ...DSH_RESERVED_NAMES,
])

/** Strip a leading `/` and lowercase so "Review" / "/review" become `review`. */
export function normalizeCommandName(raw: string): string {
  return raw.trim().replace(/^\//, '').toLowerCase()
}

export function isValidCommandName(name: string): boolean {
  return COMMAND_NAME_PATTERN.test(name) && name.length <= MAX_COMMAND_NAME_LENGTH
}

export function trimDescription(raw: string): string {
  return raw.trim().slice(0, MAX_DESCRIPTION_LENGTH)
}

export function defaultDescription(steerText: string): string {
  const text = steerText.trim().replace(/\s+/g, ' ')
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text
  return `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
}

/**
 * Validate one custom command. `taken` is other names already in the list
 * (not including this row's current name when renaming).
 */
export function validateCustomCommand(
  input: { name: string; description?: string; steerText: string },
  taken: ReadonlySet<string> = new Set(),
): { ok: true; command: CustomSlashCommand } | { ok: false; issue: CatalogIssue } {
  const name = normalizeCommandName(input.name)
  if (name.length === 0) return { ok: false, issue: { code: 'name.empty' } }
  if (name.length > MAX_COMMAND_NAME_LENGTH) {
    return { ok: false, issue: { code: 'name.tooLong', name, max: MAX_COMMAND_NAME_LENGTH } }
  }
  if (!COMMAND_NAME_PATTERN.test(name)) {
    return { ok: false, issue: { code: 'name.invalid', name } }
  }
  if (RESERVED_SLASH_NAMES.has(name)) {
    return { ok: false, issue: { code: 'name.reserved', name } }
  }
  if (taken.has(name)) {
    return { ok: false, issue: { code: 'name.taken', name } }
  }
  const description = trimDescription(input.description ?? '')
  if ((input.description ?? '').trim().length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, issue: { code: 'description.tooLong', max: MAX_DESCRIPTION_LENGTH } }
  }
  const steerText = input.steerText.trim()
  if (steerText.length === 0) return { ok: false, issue: { code: 'text.empty' } }
  if (steerText.length > MAX_STEER_TEXT_LENGTH) {
    return { ok: false, issue: { code: 'text.tooLong', max: MAX_STEER_TEXT_LENGTH } }
  }
  return {
    ok: true,
    command: {
      name,
      description: description.length > 0 ? description : defaultDescription(steerText),
      steerText,
    },
  }
}

/** Validate a full replacement list. First error wins so the UI can point at one field. */
export function validateCustomList(
  rows: readonly { name: string; description?: string; steerText: string }[],
): { ok: true; commands: CustomSlashCommand[] } | { ok: false; issue: CatalogIssue } {
  if (rows.length > MAX_CUSTOM_COMMANDS) {
    return { ok: false, issue: { code: 'tooMany', max: MAX_CUSTOM_COMMANDS } }
  }
  const commands: CustomSlashCommand[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const result = validateCustomCommand(row, seen)
    if (!result.ok) {
      if (result.issue.code === 'name.taken') {
        return { ok: false, issue: { code: 'list.duplicate', name: result.issue.name } }
      }
      return result
    }
    seen.add(result.command.name)
    commands.push(result.command)
  }
  return { ok: true, commands }
}

/** Join the builtin payload with an optional extra suffix from `/name extra`. */
export function composeAliasText(template: string, rawInput: string): string {
  const extra = rawInput.trim()
  if (extra.length === 0) return template
  return `${template}\n${extra}`
}
