/**
 * Official composer integration for DevTools network requests:
 * - insertChip: mint a real InputBar capsule (U+FFFC + occurrence) for a request;
 * - insertText: plain-text path (terminal selections, curl commands, URLs).
 * Both dispatch scoped bail events on the session carrier; the owning session's
 * input listener applies the mutation only when the span CAS passes.
 */
import {
  NET_REF_DRAG_TYPE,
  NET_REF_SOURCE,
  NET_REF_TRIGGER,
  buildNetReference,
  clipboardNetRef,
  normalizeNetRefSnapshot,
  serializeNetRefRef,
  type NetRefOccurrence,
  type NetRefSnapshot,
} from '../../shared/browser-net-ref.ts'
import type { Translate } from './types.ts'

const INSERT_EVENT = 'slash/input-insert-reference'
const INSERT_TEXT_EVENT = 'slash/input-insert-text'

export interface NetRefSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface NetRefInsertRequest {
  readonly sessionId: string
  readonly snapshot: NetRefSnapshot
  readonly span: NetRefSpan
  readonly existing: ReadonlyArray<NetRefOccurrence>
  readonly phase?: string
}

export interface NetRefTextRequest {
  readonly sessionId: string
  readonly text: string
  readonly span: NetRefSpan
  readonly phase?: string
}

export interface NetRefApi {
  rememberOccurrences(sessionId: string | undefined, existing: ReadonlyArray<NetRefOccurrence>): void
  insertChip(request: NetRefInsertRequest, t: Translate): boolean
  insertText(request: NetRefTextRequest, t: Translate): boolean
}

interface NetRefContext {
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

const existingBySession = new Map<string, NetRefOccurrence[]>()

function resolveTriggers(ctx: NetRefContext): TriggerService | undefined {
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

function resolveLocale(ctx: NetRefContext): LocaleTable | undefined {
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

function mergeExisting(...groups: ReadonlyArray<ReadonlyArray<NetRefOccurrence>>): NetRefOccurrence[] {
  const out: NetRefOccurrence[] = []
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
    if (zh !== undefined) zh[NET_REF_SOURCE] = '网络请求'
    if (en !== undefined) en[NET_REF_SOURCE] = 'Request'
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
    if (zh !== undefined && zh[NET_REF_SOURCE] === '网络请求') delete zh[NET_REF_SOURCE]
    if (en !== undefined && en[NET_REF_SOURCE] === 'Request') delete en[NET_REF_SOURCE]
  }
}

function createSource(): TriggerSource {
  return {
    trigger: NET_REF_TRIGGER,
    name: NET_REF_SOURCE,
    order: 5,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: (ref) => clipboardNetRef(ref),
      serialize: (ref) => Promise.resolve(serializeNetRefRef(ref)),
    },
  }
}

function registerNetRefSource(triggers: TriggerService): () => void {
  try {
    return triggers.registerSource(createSource())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/already registered/i.test(message)) return () => {}
    throw error
  }
}

export function installNetRefClient(ctx: NetRefContext): NetRefApi {
  const triggers = resolveTriggers(ctx)
  if (triggers !== undefined) {
    ctx.effect(() => {
      try {
        const locale = resolveLocale(ctx)
        const undoTitle = locale === undefined ? () => {} : patchMenuTitle(locale)
        const unregister = registerNetRefSource(triggers)
        return () => {
          unregister()
          undoTitle()
        }
      } catch {
        return () => {}
      }
    }, 'ui-workbench: net-ref source')
  }

  const scopedOf = (sessionId: string): ScopedCtx | undefined => {
    const sessions = ctx.sessions ?? ctx.get('sessions') as NetRefContext['sessions']
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
        notifyComposer(actx, t('netRef.busy'))
        return false
      }
      const existing = mergeExisting(
        request.existing,
        existingBySession.get(request.sessionId) ?? [],
        netRefExisting(conversationInput(actx)?.snapshot?.occurrences ?? []),
      )
      const reference = buildNetReference(request.snapshot, existing)
      if (reference === null) {
        notifyComposer(actx, t('netRef.failed'))
        return false
      }
      const applied = actx.bail(actx, INSERT_EVENT, {
        reference,
        span: request.span,
      }) === true
      if (!applied) {
        notifyComposer(actx, t('netRef.failed'))
        return false
      }
      existingBySession.set(request.sessionId, [...existing, { ref: reference.ref, label: reference.label }])
      return true
    },
    insertText(request, t) {
      const actx = scopedOf(request.sessionId)
      if (actx === undefined) return false
      if (request.phase === 'adjudicating' || request.phase === 'submitting') {
        notifyComposer(actx, t('netRef.busy'))
        return false
      }
      const text = String(request.text ?? '')
      if (text === '') return false
      return actx.bail(actx, INSERT_TEXT_EVENT, {
        text,
        span: request.span,
      }) === true
    },
  }
}

export function netRefExisting(occurrences: ReadonlyArray<{ source?: string; ref?: string; label?: string }> | null | undefined): NetRefOccurrence[] {
  if (!Array.isArray(occurrences)) return []
  return occurrences.filter(row => row.source === NET_REF_SOURCE)
}

export function readDragNetRef(dt: DataTransfer | null): NetRefSnapshot | null {
  if (dt === null) return null
  const raw = dt.getData(NET_REF_DRAG_TYPE)
  if (raw === '') return null
  try {
    return normalizeNetRefSnapshot(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function dragCarriesNetRef(dt: DataTransfer | null): boolean {
  return dt !== null && dt.types.includes(NET_REF_DRAG_TYPE)
}
