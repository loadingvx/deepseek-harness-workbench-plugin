/**
 * Official composer chips for inspected browser elements.
 * Draft holds U+FFFC; InputBar paints the chip; submit runs codec.serialize
 * which includes the original outer HTML plus XPath / CSS / JSPath.
 */
import {
  BROWSER_EL_SOURCE,
  buildBrowserElReference,
  serializeBrowserElRef,
  clipboardBrowserEl,
  type BrowserElOccurrence,
  type BrowserElSnapshot,
} from '../../shared/browser-el.ts'
import type { Translate } from './types.ts'

const INSERT_EVENT = 'slash/input-insert-reference'

export interface BrowserElSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface BrowserElInsertRequest {
  readonly sessionId: string
  readonly snapshot: BrowserElSnapshot
  readonly span: BrowserElSpan
  readonly existing: ReadonlyArray<BrowserElOccurrence>
  readonly phase?: string
}

export interface BrowserElApi {
  rememberOccurrences(sessionId: string | undefined, existing: ReadonlyArray<BrowserElOccurrence>): void
  insertChip(request: BrowserElInsertRequest, t: Translate): boolean
}

interface BrowserElContext {
  effect(fn: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  inputTriggers?: unknown
  locale?: unknown
  sessions?: { scope?(id: string): unknown }
}

interface TriggerSource {
  readonly trigger: '@' | '/'
  readonly name: string
  readonly order?: number
  candidates(
    session: { sessionId: string },
    req: { query: string; signal: AbortSignal },
  ): Promise<readonly { name: string; description?: string; hint?: string }[]>
  onPick(pick: {
    candidate: { name: string; description?: string; hint?: string }
    session?: { sessionId: string }
  }): unknown
  codec: {
    clipboardText(ref: string): string
    serialize(ref: string, signal?: AbortSignal): Promise<string>
  }
}

interface TriggerService {
  registerSource(src: TriggerSource): () => void
}

interface LocaleTable {
  dicts?: Map<string, Map<string, Record<string, string>>>
  register: (ns: string, localeOrDicts: unknown, dict?: unknown) => unknown
  subscribe?: (listener: () => void) => () => void
}

interface ScopedCtx {
  bail(thisArg: unknown, name: string, payload: unknown): unknown
  get(name: string): unknown
}

const existingBySession = new Map<string, BrowserElOccurrence[]>()

function resolveTriggers(ctx: BrowserElContext): TriggerService | undefined {
  const fromField = ctx.inputTriggers
  if (fromField !== null && typeof fromField === 'object' && 'registerSource' in fromField) {
    return fromField as TriggerService
  }
  const fromGet = ctx.get('inputTriggers')
  if (fromGet !== null && typeof fromGet === 'object' && 'registerSource' in fromGet) {
    return fromGet as TriggerService
  }
  return undefined
}

function resolveLocale(ctx: BrowserElContext): LocaleTable | undefined {
  const fromField = ctx.locale
  if (fromField !== null && typeof fromField === 'object' && 'register' in fromField) {
    return fromField as LocaleTable
  }
  const fromGet = ctx.get('locale')
  if (fromGet !== null && typeof fromGet === 'object' && 'register' in fromGet) {
    return fromGet as LocaleTable
  }
  return undefined
}

function asScoped(value: unknown): ScopedCtx | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const rec = value as { bail?: unknown; get?: unknown }
  if (typeof rec.bail !== 'function' || typeof rec.get !== 'function') return undefined
  return rec as ScopedCtx
}

function conversationInput(actx: ScopedCtx): {
  notify?: (level: string, message: string) => void
  snapshot?: { occurrences?: ReadonlyArray<{ source?: string; ref?: string; label?: string }> }
} | undefined {
  const conversation = actx.get('conversation') as {
    input?: { for?: (ctx: unknown) => unknown }
  } | undefined
  try {
    const input = conversation?.input?.for?.(actx)
    if (input === null || typeof input === 'undefined' || typeof input !== 'object') return undefined
    return input as {
      notify?: (level: string, message: string) => void
      snapshot?: { occurrences?: ReadonlyArray<{ source?: string; ref?: string; label?: string }> }
    }
  } catch {
    return undefined
  }
}

function notifyComposer(actx: ScopedCtx, text: string): void {
  conversationInput(actx)?.notify?.('error', text)
}

function mergeExisting(...groups: ReadonlyArray<ReadonlyArray<BrowserElOccurrence>>): BrowserElOccurrence[] {
  const out: BrowserElOccurrence[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const row of group) {
      const key = `${row.ref ?? ''}\0${row.label ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

function patchMenuTitle(locale: LocaleTable): () => void {
  const write = (): void => {
    const table = locale.dicts?.get('slash.menu')
    if (table === undefined) return
    const zh = table.get('zh')
    const en = table.get('en')
    if (zh !== undefined) zh[BROWSER_EL_SOURCE] = '浏览器元素'
    if (en !== undefined) en[BROWSER_EL_SOURCE] = 'Page element'
  }
  write()
  const timers = [0, 80, 400].map(ms => globalThis.setTimeout(write, ms))
  const unsub = typeof locale.subscribe === 'function' ? locale.subscribe(write) : undefined
  return () => {
    for (const id of timers) globalThis.clearTimeout(id)
    unsub?.()
    const table = locale.dicts?.get('slash.menu')
    if (table === undefined) return
    const zh = table.get('zh')
    const en = table.get('en')
    if (zh !== undefined && zh[BROWSER_EL_SOURCE] === '浏览器元素') delete zh[BROWSER_EL_SOURCE]
    if (en !== undefined && en[BROWSER_EL_SOURCE] === 'Page element') delete en[BROWSER_EL_SOURCE]
  }
}

function createSource(): TriggerSource {
  return {
    trigger: '@',
    name: BROWSER_EL_SOURCE,
    order: 4,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: (ref) => clipboardBrowserEl(ref),
      serialize: (ref) => Promise.resolve(serializeBrowserElRef(ref)),
    },
  }
}

function registerBrowserElSource(triggers: TriggerService): () => void {
  try {
    return triggers.registerSource(createSource())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/already registered/i.test(message)) return () => {}
    throw error
  }
}

export function installBrowserElClient(ctx: BrowserElContext): BrowserElApi {
  const triggers = resolveTriggers(ctx)
  if (triggers !== undefined) {
    ctx.effect(() => {
      try {
        const locale = resolveLocale(ctx)
        const undoTitle = locale === undefined ? () => {} : patchMenuTitle(locale)
        const unregister = registerBrowserElSource(triggers)
        return () => {
          unregister()
          undoTitle()
        }
      } catch {
        return () => {}
      }
    }, 'ui-workbench: browser-el source')
  }

  return {
    rememberOccurrences(sessionId, existing) {
      if (sessionId === undefined) return
      existingBySession.set(sessionId, [...existing])
    },
    insertChip(request, t) {
      const sessions = ctx.sessions ?? ctx.get('sessions') as BrowserElContext['sessions']
      const actx = asScoped(sessions?.scope?.(request.sessionId))
      if (actx === undefined) return false
      if (request.phase === 'adjudicating' || request.phase === 'submitting') {
        notifyComposer(actx, t('browser.el.busy'))
        return false
      }
      const existing = mergeExisting(
        request.existing,
        existingBySession.get(request.sessionId) ?? [],
        browserElExisting(conversationInput(actx)?.snapshot?.occurrences ?? []),
      )
      const reference = buildBrowserElReference(request.snapshot, existing)
      if (reference === null) {
        notifyComposer(actx, t('browser.el.failed'))
        return false
      }
      const applied = actx.bail(actx, INSERT_EVENT, {
        reference,
        span: request.span,
      }) === true
      if (!applied) {
        notifyComposer(actx, t('browser.el.failed'))
        return false
      }
      existingBySession.set(request.sessionId, [...existing, { ref: reference.ref, label: reference.label }])
      return true
    },
  }
}

export function browserElExisting(occurrences: ReadonlyArray<{ source?: string; ref?: string; label?: string }> | null | undefined): BrowserElOccurrence[] {
  if (!Array.isArray(occurrences)) return []
  return occurrences.filter(row => row.source === BROWSER_EL_SOURCE)
}
