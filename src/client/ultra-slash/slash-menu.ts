/**
 * Slash-menu grouping for this plugin's commands.
 *
 * DSH puts every `ctx.commands.register` row into one "命令" source and
 * fuzzy-ranks them together. Plugin commands stay in a separate source
 * (`ultra-slash`) so they keep their own order, with a divider above this
 * group when built-in commands sit first. The built-in source is filtered
 * so plugin names are not listed twice.
 */
import {
  BUILTIN_SLASH_COMMANDS,
  BUILTIN_SLASH_NAMES,
  type CustomSlashCommand,
} from '../../shared/ultra-slash/catalog.ts'
import {
  SLASH_MENU_TITLE_EN,
  SLASH_MENU_TITLE_ZH,
  translate,
  zh,
  type UltraSlashKey,
} from '../../shared/ultra-slash/locales.ts'

/** Menu group id. Locale lookup falls back to this string if titles are not patched. */
export const PLUGIN_SLASH_SOURCE = 'ultra-slash'

/** Higher than DSH `command` (0) and `skill` (2) so this group sits at the bottom of the `/` menu. */
export const PLUGIN_SLASH_ORDER = 100

/**
 * Divider on this group's title when another slash group is already above it.
 * `order` puts ultra-slash last; this only draws the line, it does not move rows.
 */
export const PLUGIN_SLASH_DIVIDER_CSS = [
  `[role="presentation"][data-source] ~ [role="presentation"][data-source="${PLUGIN_SLASH_SOURCE}"]{`,
  'border-top:1px solid var(--dsw-alias-border-inverted, rgba(127,127,127,.35));',
  'margin-top:4px;',
  'padding-top:10px;',
  '}',
].join('')

/** One plugin-owned slash row. Keep in registration order. */
export interface PluginSlashCommand {
  readonly name: string
  readonly descriptionKey: UltraSlashKey
  readonly hintKey?: UltraSlashKey
}

/** Commands this plugin ships. Custom rows are appended at candidate time. */
export const PLUGIN_SLASH_COMMANDS: readonly PluginSlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
  name: command.name,
  descriptionKey: command.descriptionKey,
  ...(command.hintKey === undefined ? {} : { hintKey: command.hintKey }),
}))

export const PLUGIN_SLASH_NAMES: ReadonlySet<string> = BUILTIN_SLASH_NAMES

/** Menu row DSH's input-trigger pipeline understands. */
export interface SlashCandidate {
  readonly name: string
  readonly description: string
  readonly hint: string
}

export function toSlashCandidate(
  command: PluginSlashCommand,
  t: (key: string) => string = (key) => zh[key as UltraSlashKey] ?? key,
): SlashCandidate {
  return {
    name: command.name,
    description: t(command.descriptionKey),
    hint: command.hintKey === undefined ? '' : t(command.hintKey),
  }
}

export function customToSlashCandidate(
  command: CustomSlashCommand,
  hint = '',
): SlashCandidate {
  return {
    name: command.name,
    description: command.description,
    hint,
  }
}

/**
 * Filter this plugin's commands independently of DSH fuzzy ranking.
 * Empty query keeps catalog order. A query keeps prefix matches first, then
 * substring matches, still in catalog order within each bucket.
 */
export function filterPluginCommands<T extends { readonly name: string }>(
  commands: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...commands]
  const prefix: T[] = []
  const rest: T[] = []
  for (const command of commands) {
    const name = command.name.toLowerCase()
    if (name.startsWith(needle)) prefix.push(command)
    else if (name.includes(needle)) rest.push(command)
  }
  return [...prefix, ...rest]
}

export function pluginSlashCandidates(
  query: string,
  leading: boolean,
  t: (key: string) => string = (key) => translate('zh', key as UltraSlashKey),
  custom: readonly CustomSlashCommand[] = [],
): SlashCandidate[] {
  if (!leading) return []
  const hint = t('alias.hint')
  const rows: SlashCandidate[] = [
    ...PLUGIN_SLASH_COMMANDS.map((command) => toSlashCandidate(command, t)),
    ...custom.map((command) => customToSlashCandidate(command, hint)),
  ]
  return filterPluginCommands(rows, query)
}

export function pluginSlashNameSet(customNames: readonly string[] = []): Set<string> {
  const names = new Set(PLUGIN_SLASH_NAMES)
  for (const name of customNames) names.add(name)
  return names
}

/** Structural slice of one `/` source on `ctx.inputTriggers`. */
export interface SlashSource {
  readonly trigger: '/' | '@'
  readonly name: string
  readonly order?: number
  candidates: (
    session: unknown,
    req: { query: string; position: 'leading' | 'inline'; signal: AbortSignal },
  ) => Promise<readonly { readonly name: string; readonly description?: string; readonly hint?: string }[]>
  onPick: (pick: unknown) => unknown
  matchSpace?: (session: unknown, token: string) => unknown
  matchEnter?: (session: unknown, line: string, signal: AbortSignal) => Promise<unknown>
  warm?: (session: unknown) => void
}

export interface SlashTriggerService {
  registerSource(src: SlashSource): () => void
  live?: { sources: SlashSource[] }
}

const WRAPPED = Symbol.for('deepseek-harness-ultra-slash.command-source-wrapped')

function isCommandSource(source: SlashSource): boolean {
  return source.trigger === '/' && source.name === 'command'
}

/**
 * Hide plugin command names from the built-in "命令" list so they only appear
 * in the ultra-slash group. Execution (`matchSpace` / `matchEnter` / `onPick`)
 * stays on the original source.
 */
export function hidePluginNamesFromCommandSource(
  source: SlashSource,
  names: { has(name: string): boolean } = PLUGIN_SLASH_NAMES,
): () => void {
  if (!isCommandSource(source)) return () => {}
  if (Reflect.get(source, WRAPPED) === true) return () => {}
  const original = source.candidates
  source.candidates = async (session, req) => {
    const rows = await original.call(source, session, req)
    return rows.filter((row) => !names.has(row.name))
  }
  Reflect.set(source, WRAPPED, true)
  return () => {
    source.candidates = original
    Reflect.set(source, WRAPPED, false)
  }
}

/**
 * Wrap the live command source (already registered) and any later
 * `registerSource` of `command`, so plugin names stay out of DSH ranking.
 */
export function installCommandSourceFilter(
  service: SlashTriggerService,
  names: { has(name: string): boolean } = PLUGIN_SLASH_NAMES,
): () => void {
  const undo: Array<() => void> = []
  const wrap = (source: SlashSource): void => {
    undo.push(hidePluginNamesFromCommandSource(source, names))
  }
  for (const source of service.live?.sources ?? []) wrap(source)
  const originalRegister = service.registerSource
  service.registerSource = (source: SlashSource) => {
    wrap(source)
    return originalRegister.call(service, source)
  }
  return () => {
    service.registerSource = originalRegister
    while (undo.length > 0) undo.pop()?.()
  }
}

export function findCommandSource(service: SlashTriggerService): SlashSource | undefined {
  return (service.live?.sources ?? []).find((source) => isCommandSource(source))
}

export { SLASH_MENU_TITLE_EN, SLASH_MENU_TITLE_ZH } from '../../shared/ultra-slash/locales.ts'

/** Structural locale registry used to label the ultra-slash group. */
export interface LocaleRegistry {
  dicts?: Map<string, Map<string, Record<string, string>>>
  register: (ns: string, localeOrDicts: unknown, dict?: unknown) => unknown
}

/**
 * `slash.menu` is owned by DSH; a second `locale.register('slash.menu')` throws.
 * Write the group title onto the existing dictionaries instead.
 */
export function patchSlashMenuGroupTitle(locale: LocaleRegistry): () => void {
  const write = (): void => {
    const table = locale.dicts?.get('slash.menu')
    if (table === undefined) return
    const zh = table.get('zh')
    const en = table.get('en')
    if (zh !== undefined) zh[PLUGIN_SLASH_SOURCE] = SLASH_MENU_TITLE_ZH
    if (en !== undefined) en[PLUGIN_SLASH_SOURCE] = SLASH_MENU_TITLE_EN
  }
  write()
  const original = locale.register
  locale.register = (ns: string, localeOrDicts: unknown, dict?: unknown) => {
    const result = original.call(locale, ns, localeOrDicts, dict)
    if (ns === 'slash.menu') write()
    return result
  }
  return () => {
    locale.register = original
    const table = locale.dicts?.get('slash.menu')
    if (table === undefined) return
    const zh = table.get('zh')
    const en = table.get('en')
    if (zh !== undefined && zh[PLUGIN_SLASH_SOURCE] === SLASH_MENU_TITLE_ZH) delete zh[PLUGIN_SLASH_SOURCE]
    if (en !== undefined && en[PLUGIN_SLASH_SOURCE] === SLASH_MENU_TITLE_EN) delete en[PLUGIN_SLASH_SOURCE]
  }
}
