/**
 * Browser half: ultra-slash `/` group and `/new` session switch.
 * The settings UI lives in the workbench SideDock, not DSH Settings.
 */
import { PLUGIN_NAME } from '../../shared/ultra-slash/ids.ts'
import { translate, type UltraSlashKey, type UiLocale } from '../../shared/ultra-slash/locales.ts'
import {
  findCommandSource,
  installCommandSourceFilter,
  patchSlashMenuGroupTitle,
  PLUGIN_SLASH_DIVIDER_CSS,
  PLUGIN_SLASH_NAMES,
  PLUGIN_SLASH_ORDER,
  PLUGIN_SLASH_SOURCE,
  pluginSlashCandidates,
  type LocaleRegistry,
  type SlashTriggerService,
} from './slash-menu.ts'
import { installNewSessionBridge, newSlashMatchEnter, newSlashMatchSpace, startNewSession } from './new-session.ts'
import { getSlashCache, setSlashI18n } from './runtime.ts'

const DIVIDER_STYLE_ID = `${PLUGIN_NAME}-divider`

interface LocaleFace extends LocaleRegistry {
  bind?: (ns: string) => (key: string, vars?: Record<string, string | number>) => string
  register: (ns: string, localeOrDicts: unknown, dict?: unknown) => unknown
  subscribe?: (listener: () => void) => () => void
  getSnapshot?: () => { active?: string }
}

interface UltraSlashClientContext {
  effect(fn: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  inputTriggers?: unknown
  locale?: unknown
}

function injectDividerStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(DIVIDER_STYLE_ID) !== null) return () => {}
  const tag = document.createElement('style')
  tag.id = DIVIDER_STYLE_ID
  tag.textContent = PLUGIN_SLASH_DIVIDER_CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

function resolveLocale(ctx: UltraSlashClientContext): LocaleFace | undefined {
  const fromField = ctx.locale
  if (fromField !== null && typeof fromField === 'object' && 'bind' in fromField) {
    return fromField as LocaleFace
  }
  const fromGet = ctx.get('locale')
  if (fromGet !== null && typeof fromGet === 'object' && 'bind' in fromGet) {
    return fromGet as LocaleFace
  }
  return undefined
}

function bindMenuTranslate(locale: LocaleFace | undefined): (key: string, vars?: Record<string, string | number>) => string {
  const lang = activeLocale(locale)
  return (key, vars) => translate(lang, key as UltraSlashKey, vars)
}

function activeLocale(locale: LocaleFace | undefined): UiLocale {
  return locale?.getSnapshot?.()?.active === 'en' ? 'en' : 'zh'
}

function syncI18n(locale: LocaleFace | undefined): void {
  setSlashI18n({
    locale: activeLocale(locale),
    t: bindMenuTranslate(locale),
  })
}

function resolveTriggerService(ctx: UltraSlashClientContext): SlashTriggerService | undefined {
  const fromField = ctx.inputTriggers
  if (fromField !== null && typeof fromField === 'object' && 'registerSource' in fromField) {
    return fromField as SlashTriggerService
  }
  const fromGet = ctx.get('inputTriggers')
  if (fromGet !== null && typeof fromGet === 'object' && 'registerSource' in fromGet) {
    return fromGet as SlashTriggerService
  }
  return undefined
}

function syncHiddenNames(
  hidden: Set<string>,
  customNames: readonly string[],
): void {
  hidden.clear()
  for (const name of PLUGIN_SLASH_NAMES) hidden.add(name)
  for (const name of customNames) hidden.add(name)
}

/** Register the ultra-slash `/` group and `/new` bridge. Chat behavior stays the same. */
export function installUltraSlashClient(ctx: UltraSlashClientContext): void {
  const inputTriggers = resolveTriggerService(ctx)
  if (inputTriggers === undefined) return

  const locale = resolveLocale(ctx)
  const cache = getSlashCache()
  const hiddenNames = new Set(PLUGIN_SLASH_NAMES)
  syncI18n(locale)
  void cache.refresh().then((result) => {
    if (result.ok) syncHiddenNames(hiddenNames, result.commands.map((command) => command.name))
  })
  ctx.effect(() => cache.subscribe(() => {
    syncHiddenNames(hiddenNames, cache.list().map((command) => command.name))
  }), `${PLUGIN_NAME}: hidden names`)

  ctx.effect(() => {
    if (locale === undefined) return () => {}
    const undoTitle = patchSlashMenuGroupTitle(locale)
    const undoLocale = typeof locale.subscribe === 'function'
      ? locale.subscribe(() => { syncI18n(locale) })
      : undefined
    syncI18n(locale)
    return () => {
      if (typeof undoLocale === 'function') undoLocale()
      undoTitle()
    }
  }, `${PLUGIN_NAME}: locale`)

  ctx.effect(() => injectDividerStyle(), `${PLUGIN_NAME}: slash divider`)

  ctx.effect(() => {
    const t = bindMenuTranslate(locale)
    const source = {
      trigger: '/' as const,
      name: PLUGIN_SLASH_SOURCE,
      order: PLUGIN_SLASH_ORDER,
      candidates: (
        _session: unknown,
        req: { query: string; position: 'leading' | 'inline'; signal: AbortSignal },
      ) => Promise.resolve(pluginSlashCandidates(
        req.query,
        req.position === 'leading',
        t,
        cache.list(),
      )),
      onPick: (pick: unknown) => {
        const command = findCommandSource(inputTriggers)
        if (command !== undefined) return command.onPick(pick)
        const candidate = (pick as { candidate?: { name?: string } } | null)?.candidate
        const commandName = typeof candidate?.name === 'string' ? candidate.name : ''
        if (commandName === '') return undefined
        return { text: `/${commandName} ` }
      },
      matchSpace: newSlashMatchSpace((name) => ctx.get(name), bindMenuTranslate(locale)),
      matchEnter: newSlashMatchEnter((name) => ctx.get(name), bindMenuTranslate(locale)),
    }
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
    }
  }, `${PLUGIN_NAME}: ultra-slash source`)

  ctx.effect(
    () => installCommandSourceFilter(inputTriggers, hiddenNames),
    `${PLUGIN_NAME}: hide plugin names from 命令`,
  )

  ctx.effect(
    () => installNewSessionBridge(inputTriggers, (initialText) => {
      startNewSession((name) => ctx.get(name), initialText)
    }),
    `${PLUGIN_NAME}: /new session`,
  )
}
