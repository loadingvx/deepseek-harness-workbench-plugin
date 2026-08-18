/**
 * Official composer file chips: `@` source + insert-reference on drop.
 * Draft holds U+FFFC; InputBar paints the chip; submit runs codec.serialize.
 */
import type { GitClient } from '../api.ts'
import {
  buildFileReference,
  FILE_REF_KIND_TYPE,
  FILE_REF_PATH_TYPE,
  FILE_REF_SOURCE,
  FILE_REF_TRIGGER,
  serializeFileRef,
  type FileRefKind,
  type FileRefOccurrence,
} from '../../shared/file-ref.ts'
import type { Translate } from './types.ts'

const MENU_ORDER = 3
const MENU_LIMIT = 40
const INSERT_EVENT = 'slash/input-insert-reference'

export interface FileRefSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface FileRefInsertRequest {
  readonly sessionId: string
  readonly kind: FileRefKind
  readonly relPath: string
  readonly span: FileRefSpan
  readonly existing: ReadonlyArray<FileRefOccurrence>
  readonly phase?: string
}

export interface FileRefApi {
  bindWorkspace(sessionId: string | undefined, workspaceId: string | undefined): void
  rememberOccurrences(sessionId: string | undefined, existing: ReadonlyArray<FileRefOccurrence>): void
  insertChip(request: FileRefInsertRequest, t: Translate): boolean
}

interface FileRefContext {
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

const workspaceBySession = new Map<string, string>()
const existingBySession = new Map<string, FileRefOccurrence[]>()
const hitsBySession = new Map<string, Array<{ path: string; kind: FileRefKind }>>()

function resolveTriggers(ctx: FileRefContext): TriggerService | undefined {
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

function resolveLocale(ctx: FileRefContext): LocaleTable | undefined {
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
    if (input === null || typeof input !== 'object') return undefined
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

function mergeExisting(...groups: ReadonlyArray<ReadonlyArray<FileRefOccurrence>>): FileRefOccurrence[] {
  const out: FileRefOccurrence[] = []
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
    if (zh !== undefined) zh[FILE_REF_SOURCE] = '文件'
    if (en !== undefined) en[FILE_REF_SOURCE] = 'Files'
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
    if (zh !== undefined && zh[FILE_REF_SOURCE] === '文件') delete zh[FILE_REF_SOURCE]
    if (en !== undefined && en[FILE_REF_SOURCE] === 'Files') delete en[FILE_REF_SOURCE]
  }
}

function createSource(client: GitClient): TriggerSource {
  return {
    trigger: FILE_REF_TRIGGER,
    name: FILE_REF_SOURCE,
    order: MENU_ORDER,
    async candidates(session, req) {
      const workspaceId = workspaceBySession.get(session.sessionId)
      if (workspaceId === undefined) return []
      const query = req.query.trim()
      const result = query === ''
        ? await client.listDir(workspaceId, '')
        : await client.searchFiles(workspaceId, query, query.startsWith('.'))
      if (!result.ok) return []
      if (req.signal.aborted) return []
      const rows = ('entries' in result.value ? result.value.entries : result.value.hits).slice(0, MENU_LIMIT)
      hitsBySession.set(session.sessionId, rows.map(row => ({ path: row.path, kind: row.kind })))
      return rows.map(row => ({
        name: row.path,
        description: row.kind === 'directory' ? row.name : row.path,
      }))
    },
    onPick(pick) {
      const name = pick.candidate.name
      const sessionHits = pick.session === undefined ? undefined : hitsBySession.get(pick.session.sessionId)
      const kind = (sessionHits ?? [...hitsBySession.values()].flat()).find(row => row.path === name)?.kind ?? 'file'
      const existing = pick.session === undefined
        ? []
        : existingBySession.get(pick.session.sessionId) ?? []
      const insert = buildFileReference(kind, name, existing)
      return insert === null ? undefined : { insert }
    },
    codec: {
      clipboardText: (ref) => serializeFileRef(ref),
      serialize: (ref) => Promise.resolve(serializeFileRef(ref)),
    },
  }
}

export function installFileRefClient(ctx: FileRefContext, client: GitClient): FileRefApi {
  const triggers = resolveTriggers(ctx)
  if (triggers !== undefined) {
    ctx.effect(() => {
      const locale = resolveLocale(ctx)
      const undoTitle = locale === undefined ? () => {} : patchMenuTitle(locale)
      const unregister = triggers.registerSource(createSource(client))
      return () => {
        unregister()
        undoTitle()
      }
    }, 'ui-workbench: file-ref source')
  }

  return {
    bindWorkspace(sessionId, workspaceId) {
      if (sessionId === undefined) return
      if (workspaceId === undefined || workspaceId === '') {
        workspaceBySession.delete(sessionId)
        existingBySession.delete(sessionId)
        hitsBySession.delete(sessionId)
        return
      }
      workspaceBySession.set(sessionId, workspaceId)
    },
    rememberOccurrences(sessionId, existing) {
      if (sessionId === undefined) return
      existingBySession.set(sessionId, [...existing])
    },
    insertChip(request, t) {
      const sessions = ctx.sessions ?? ctx.get('sessions') as FileRefContext['sessions']
      const actx = asScoped(sessions?.scope?.(request.sessionId))
      if (actx === undefined) return false
      if (request.phase === 'adjudicating' || request.phase === 'submitting') {
        notifyComposer(actx, t('fileRef.busy'))
        return false
      }
      const existing = mergeExisting(
        request.existing,
        existingBySession.get(request.sessionId) ?? [],
        fileRefExisting(conversationInput(actx)?.snapshot?.occurrences ?? []),
      )
      const reference = buildFileReference(request.kind, request.relPath, existing)
      if (reference === null) {
        notifyComposer(actx, t('fileRef.failed'))
        return false
      }
      const applied = actx.bail(actx, INSERT_EVENT, {
        reference,
        span: request.span,
      }) === true
      if (!applied) {
        notifyComposer(actx, t('fileRef.failed'))
        return false
      }
      existingBySession.set(request.sessionId, [...existing, { ref: reference.ref, label: reference.label }])
      return true
    },
  }
}

export function readDragPath(dt: DataTransfer | null): string | null {
  if (dt === null) return null
  const rel = dt.getData(FILE_REF_PATH_TYPE)
  return rel === '' ? null : rel
}

export function readDragKind(dt: DataTransfer | null): FileRefKind {
  if (dt === null) return 'file'
  return dt.getData(FILE_REF_KIND_TYPE) === 'directory' ? 'directory' : 'file'
}

export function dragCarriesFileRef(dt: DataTransfer | null): boolean {
  return dt !== null && dt.types.includes(FILE_REF_PATH_TYPE)
}

export function composerSeatOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-composer-seat]')
}

export function composerSelection(seat: HTMLElement, draftLength: number): { start: number; end: number } {
  const textarea = seat.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea === null) return { start: draftLength, end: draftLength }
  const start = textarea.selectionStart ?? draftLength
  const end = textarea.selectionEnd ?? start
  return { start, end }
}

export function fileRefExisting(occurrences: ReadonlyArray<{ source?: string; ref?: string; label?: string }>): FileRefOccurrence[] {
  return occurrences.filter(row => row.source === FILE_REF_SOURCE)
}
