/**
 * Official composer integration for editor content (selection / whole file):
 * mint a real InputBar capsule (U+FFFC + occurrence) exactly like file /
 * terminal / network chips — the single established "send workbench content
 * into the session window" mechanism.
 */
import {
  EDITOR_REF_SOURCE,
  EDITOR_REF_TRIGGER,
  buildEditorReference,
  clipboardEditorRef,
  serializeEditorRefRef,
  type EditorRefOccurrence,
  type EditorRefSnapshot,
} from '../../shared/editor-ref.ts'
import type { Translate } from './types.ts'

const INSERT_EVENT = 'slash/input-insert-reference'

export interface EditorRefSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface EditorRefInsertRequest {
  readonly sessionId: string
  readonly snapshot: EditorRefSnapshot
  readonly span: EditorRefSpan
  readonly existing: ReadonlyArray<EditorRefOccurrence>
  readonly phase?: string
}

export interface EditorRefApi {
  rememberOccurrences(sessionId: string | undefined, existing: ReadonlyArray<EditorRefOccurrence>): void
  insertChip(request: EditorRefInsertRequest, t: Translate): boolean
}

interface EditorRefContext {
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

const existingBySession = new Map<string, EditorRefOccurrence[]>()

function resolveTriggers(ctx: EditorRefContext): TriggerService | undefined {
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

function resolveLocale(ctx: EditorRefContext): LocaleTable | undefined {
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

function mergeExisting(...groups: ReadonlyArray<ReadonlyArray<EditorRefOccurrence>>): EditorRefOccurrence[] {
  const out: EditorRefOccurrence[] = []
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
    if (zh !== undefined) zh[EDITOR_REF_SOURCE] = '编辑器内容'
    if (en !== undefined) en[EDITOR_REF_SOURCE] = 'Editor'
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
    if (zh !== undefined && zh[EDITOR_REF_SOURCE] === '编辑器内容') delete zh[EDITOR_REF_SOURCE]
    if (en !== undefined && en[EDITOR_REF_SOURCE] === 'Editor') delete en[EDITOR_REF_SOURCE]
  }
}

function createSource(): TriggerSource {
  return {
    trigger: EDITOR_REF_TRIGGER,
    name: EDITOR_REF_SOURCE,
    order: 7,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: (ref) => clipboardEditorRef(ref),
      serialize: (ref) => Promise.resolve(serializeEditorRefRef(ref)),
    },
  }
}

function registerEditorRefSource(triggers: TriggerService): () => void {
  try {
    return triggers.registerSource(createSource())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/already registered/i.test(message)) return () => {}
    throw error
  }
}

export function installEditorRefClient(ctx: EditorRefContext): EditorRefApi {
  const triggers = resolveTriggers(ctx)
  if (triggers !== undefined) {
    ctx.effect(() => {
      try {
        const locale = resolveLocale(ctx)
        const undoTitle = locale === undefined ? () => {} : patchMenuTitle(locale)
        const unregister = registerEditorRefSource(triggers)
        return () => {
          unregister()
          undoTitle()
        }
      } catch {
        return () => {}
      }
    }, 'ui-workbench: editor-ref source')
  }

  const scopedOf = (sessionId: string): ScopedCtx | undefined => {
    const sessions = ctx.sessions ?? ctx.get('sessions') as EditorRefContext['sessions']
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
        notifyComposer(actx, t('editorRef.busy'))
        return false
      }
      const existing = mergeExisting(
        request.existing,
        existingBySession.get(request.sessionId) ?? [],
        editorRefExisting(conversationInput(actx)?.snapshot?.occurrences ?? []),
      )
      const reference = buildEditorReference(request.snapshot, existing)
      if (reference === null) {
        notifyComposer(actx, t('editorRef.failed'))
        return false
      }
      const applied = actx.bail(actx, INSERT_EVENT, {
        reference,
        span: request.span,
      }) === true
      if (!applied) {
        notifyComposer(actx, t('editorRef.failed'))
        return false
      }
      existingBySession.set(request.sessionId, [...existing, { ref: reference.ref, label: reference.label }])
      return true
    },
  }
}

export function editorRefExisting(occurrences: ReadonlyArray<{ source?: string; ref?: string; label?: string }> | null | undefined): EditorRefOccurrence[] {
  if (!Array.isArray(occurrences)) return []
  return occurrences.filter(row => row.source === EDITOR_REF_SOURCE)
}
