/**
 * Browser half: ultra-slash `/` group and `/new` session switch.
 * The settings UI lives in the workbench SideDock, not DSH Settings.
 *
 * Conflicts with a leftover standalone ultra-slash install are handled by
 * yielding: if the `/ultra-slash` slash source is already registered, this
 * half stands down for it so the web app always mounts. The `/new` bridge is
 * only installed when this half actually owns the slash source — a double
 * bridge would start two sessions per `/new`.
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
  pluginLexicon,
  pluginSlashCandidates,
  type LocaleRegistry,
  type SlashSource,
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

/**
 * Whether the `/ultra-slash` slash source is already owned (a leftover
 * standalone ultra-slash install registered first).
 */
export function slashSourceTaken(service: SlashTriggerService): boolean {
  return (service.live?.sources ?? []).some(
    (source) => source.trigger === '/' && source.name === PLUGIN_SLASH_SOURCE,
  )
}

/**
 * Register the plugin's `/` source, standing down when the group name is
 * already owned. Returns the disposer plus whether this half actually owns
 * the source (false on a yield).
 */
function registerSourceTolerant(
  service: SlashTriggerService,
  source: SlashSource,
): { dispose: () => void; owned: boolean } {
  if (slashSourceTaken(service)) {
    console.warn(
      '[dsh-workbench-plugin] slash source "/' + PLUGIN_SLASH_SOURCE + '" is already registered '
      + '(a leftover deepseek-harness-ultra-slash install); this half stands down for it. '
      + 'No data is touched; the owner keeps serving the group.',
    )
    return { dispose: () => {}, owned: false }
  }
  const dispose = service.registerSource(source)
  return { dispose, owned: true }
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

  // The bridge must only run when this half owns the slash source: a double
  // bridge would start two sessions for one /new.
  let ownSource = false

  ctx.effect(() => {
    const t = bindMenuTranslate(locale)
    const readNewDefault = (): string => cache.defaults().new ?? ''
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
      matchSpace: newSlashMatchSpace((name) => ctx.get(name), t, readNewDefault),
      matchEnter: newSlashMatchEnter((name) => ctx.get(name), t, readNewDefault),
      // The text-ref lexicon: the plugin's command names highlight in the
      // composer textarea in every session state (the roll is derived from
      // the persisted catalog, never from the session's running state).
      lexicon: () => pluginLexicon(cache.list().map((command) => command.name)),
      subscribeLexicon: (_session: unknown, listener: () => void) => cache.subscribe(listener),
    }
    const outcome = registerSourceTolerant(inputTriggers, source)
    ownSource = outcome.owned
    return () => {
      outcome.dispose()
      ownSource = false
    }
  }, `${PLUGIN_NAME}: ultra-slash source`)

  ctx.effect(
    () => installCommandSourceFilter(inputTriggers, hiddenNames),
    `${PLUGIN_NAME}: hide plugin names from 命令`,
  )

  ctx.effect(
    () => {
      if (!ownSource) return () => {}
      return installNewSessionBridge(inputTriggers, (initialText) => {
        const text = initialText.trim().length > 0 ? initialText : cache.defaults().new ?? ''
        startNewSession((name) => ctx.get(name), text)
      })
    },
    `${PLUGIN_NAME}: /new session`,
  )
}
