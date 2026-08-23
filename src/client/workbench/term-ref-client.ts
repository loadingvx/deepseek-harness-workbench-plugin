/**
 * Official composer integration for terminal content (selection / recent
 * output): mint a real InputBar capsule (U+FFFC + occurrence) exactly like
 * file / browser-element / network-request chips — the single established
 * "send workbench content into the session window" mechanism.
 */
import {
  TERM_REF_SOURCE,
  TERM_REF_TRIGGER,
  buildTermReference,
  clipboardTermRef,
  serializeTermRefRef,
  type TermRefOccurrence,
  type TermRefSnapshot,
} from '../../shared/term-ref.ts'
import type { Translate } from './types.ts'

const INSERT_EVENT = 'slash/input-insert-reference'

export interface TermRefSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface TermRefInsertRequest {
  readonly sessionId: string
  readonly snapshot: TermRefSnapshot
  readonly span: TermRefSpan
  readonly existing: ReadonlyArray<TermRefOccurrence>
  readonly phase?: string
}

export interface TermRefApi {
  rememberOccurrences(sessionId: string | undefined, existing: ReadonlyArray<TermRefOccurrence>): void
  insertChip(request: TermRefInsertRequest, t: Translate): boolean
}

interface TermRefContext {
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
}

interface ScopedCtx {
  bail(thisArg: unknown, name: string, payload: unknown): unknown
  get(name: string): unknown
}

const existingBySession = new Map<string, TermRefOccurrence[]>()

function resolveTriggers(ctx: TermRefContext): TriggerService | undefined {
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

function resolveLocale(ctx: TermRefContext): LocaleTable | undefined {
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

function mergeExisting(...groups: ReadonlyArray<ReadonlyArray<TermRefOccurrence>>): TermRefOccurrence[] {
  const out: TermRefOccurrence[] = []
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
    if (zh !== undefined) zh[TERM_REF_SOURCE] = '终端内容'
    if (en !== undefined) en[TERM_REF_SOURCE] = 'Terminal'
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
    if (zh !== undefined && zh[TERM_REF_SOURCE] === '终端内容') delete zh[TERM_REF_SOURCE]
    if (en !== undefined && en[TERM_REF_SOURCE] === 'Terminal') delete en[TERM_REF_SOURCE]
  }
}

function createSource(): TriggerSource {
  return {
    trigger: TERM_REF_TRIGGER,
    name: TERM_REF_SOURCE,
    order: 6,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: (ref) => clipboardTermRef(ref),
      serialize: (ref) => Promise.resolve(serializeTermRefRef(ref)),
    },
  }
}

function registerTermRefSource(triggers: TriggerService): () => void {
  try {
    return triggers.registerSource(createSource())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/already registered/i.test(message)) return () => {}
    throw error
  }
}

export function installTermRefClient(ctx: TermRefContext): TermRefApi {
  const triggers = resolveTriggers(ctx)
  if (triggers !== undefined) {
    ctx.effect(() => {
      try {
        const locale = resolveLocale(ctx)
        const undoTitle = locale === undefined ? () => {} : patchMenuTitle(locale)
        const unregister = registerTermRefSource(triggers)
        return () => {
          unregister()
          undoTitle()
        }
      } catch {
        return () => {}
      }
    }, 'ui-workbench: term-ref source')
  }

  const scopedOf = (sessionId: string): ScopedCtx | undefined => {
    const sessions = ctx.sessions ?? ctx.get('sessions') as TermRefContext['sessions']
    return asScoped(sessions?.scope?.(sessionId))
  }

  return {
    rememberOccurrences(sessionId, existing) {
      if (sessionId === undefined) return
      existingBySession.set(sessionId, [...existing])
    },
    insertChip(request, t) {
      const actx = scopedOf(request.sessionId)
      if (actx === undefined) return false
      if (request.phase === 'adjudicating' || request.phase === 'submitting') {
        notifyComposer(actx, t('termRef.busy'))
        return false
      }
      const existing = mergeExisting(
        request.existing,
        existingBySession.get(request.sessionId) ?? [],
        termRefExisting(conversationInput(actx)?.snapshot?.occurrences ?? []),
      )
      const reference = buildTermReference(request.snapshot, existing)
      if (reference === null) {
        notifyComposer(actx, t('termRef.failed'))
        return false
      }
      const applied = actx.bail(actx, INSERT_EVENT, {
        reference,
        span: request.span,
      }) === true
      if (!applied) {
        notifyComposer(actx, t('termRef.failed'))
        return false
      }
      existingBySession.set(request.sessionId, [...existing, { ref: reference.ref, label: reference.label }])
      return true
    },
  }
}

export function termRefExisting(occurrences: ReadonlyArray<{ source?: string; ref?: string; label?: string }> | null | undefined): TermRefOccurrence[] {
  if (!Array.isArray(occurrences)) return []
  return occurrences.filter(row => row.source === TERM_REF_SOURCE)
}
