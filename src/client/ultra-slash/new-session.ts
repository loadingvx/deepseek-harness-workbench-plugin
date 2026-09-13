import { NEW_COMMAND_NAME } from '../../shared/ultra-slash/ids.ts'
import type { SlashSource, SlashTriggerService } from './slash-menu.ts'

/** One message we can queue into a session (structural slice of `sessions.binding`). */
interface SessionPromptFace {
  prompt(
    content: Array<{ type: string; text: string }>,
    mode: 'queue' | 'steer',
  ): Promise<{ ok: boolean }>
}

/** Workspace row used to pick the target account for a new session. */
interface WorkspaceRow {
  readonly workspaceId: string
  readonly sessionIds: readonly string[]
  readonly createdAt?: string
  readonly path?: string
}

interface SessionSummaryRow {
  readonly updatedAt?: number
  readonly blank?: boolean
  readonly cwd?: string
  readonly projectionValues?: { readonly agentPreset?: string }
}

/** Structural slice of the client `sessions` service used to address the new session. */
export interface SessionsFace {
  list?: {
    getSnapshot(): {
      current?: string
      phase?: string
      ids?: readonly string[]
      byId?: Record<string, SessionSummaryRow>
    }
    subscribe?(fn: () => void): () => void
  }
  create?: (opts?: { workspaceId?: string; agentPreset?: string }) => Promise<string>
  open?: (id: string) => void
  refresh?: () => Promise<void>
  binding(id: string): { session?: SessionPromptFace } | undefined
}

interface WorkspacesFace {
  list?: {
    getSnapshot(): {
      items: readonly WorkspaceRow[]
      phase?: string
      archivedSessionIds?: readonly string[]
    }
  }
}

interface RemoteFace {
  session?: {
    create(request: {
      workspaceId?: string
      agentPreset?: string
    }): Promise<{
      ok: boolean
      value?: { sessionId: string }
      error?: unknown
    }>
  }
  agentPresets?: {
    list(): Promise<{
      ok: boolean
      value?: { presets: ReadonlyArray<{ id: string }> }
    }>
  }
}

/** Harness renamed `code` → `ptc` in newer releases. */
const LEGACY_PRESET_ALIASES: Readonly<Record<string, string>> = { code: 'ptc' }

const FALLBACK_PRESET_IDS = ['standard', 'ptc', 'minimal', 'cordis'] as const

interface UiWorkspaceFace {
  startSession?: (workspaceId?: string) => void
  openSession?: (sessionId: string) => void
  openWorkspace?: (workspaceId: string, beforeOpen?: (sessionId: string) => void) => Promise<void>
}

export function leadingCommandName(line: string): string | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line.trim())
  return match?.[1]
}

/** Text after the leading `/name` token, trimmed; newlines inside the payload are kept. */
export function leadingCommandInput(line: string): string {
  const trimmed = line.trim()
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(trimmed)
  if (match === null) return ''
  return trimmed.slice(match[0].length).trim()
}

function currentSessionId(get: (name: string) => unknown): string | undefined {
  const sessions = get('sessions') as SessionsFace | undefined
  return sessions?.list?.getSnapshot().current
}

/**
 * Pick the workspace for a new session: current session's account, else the
 * most recently updated account (Host order breaks ties). Mirrors DSH
 * `uiWorkspace.startSession` target resolution.
 */
export function resolveTargetWorkspaceId(get: (name: string) => unknown): string | undefined {
  const sessions = get('sessions') as SessionsFace | undefined
  const workspaces = get('workspaces') as WorkspacesFace | undefined
  const sessionSnap = sessions?.list?.getSnapshot()
  const workspaceSnap = workspaces?.list?.getSnapshot()
  const items = workspaceSnap?.items ?? []
  const current = sessionSnap?.current
  if (current !== undefined) {
    const owned = items.find((item) => item.sessionIds.includes(current))
    if (owned !== undefined) return owned.workspaceId
  }
  const bothReady = workspaceSnap?.phase === 'ready' && sessionSnap?.phase === 'ready'
  if (!bothReady) return items[0]?.workspaceId
  const byId = sessionSnap?.byId ?? {}
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const row = byId[sessionId]
      if (row?.updatedAt !== undefined) latest = Math.max(latest, row.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY && workspace.createdAt !== undefined) {
      const parsed = Date.parse(workspace.createdAt)
      if (!Number.isNaN(parsed)) latest = parsed
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/** Read the current session's agent preset projection, if any. */
export function currentAgentPreset(get: (name: string) => unknown): string | undefined {
  const sessions = get('sessions') as SessionsFace | undefined
  const current = sessions?.list?.getSnapshot().current
  if (current === undefined) return undefined
  const raw = sessions?.list?.getSnapshot().byId?.[current]?.projectionValues?.agentPreset
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/** Map a possibly-legacy preset id to one that exists in the current roster. */
export function pickAvailablePreset(
  wanted: string | undefined,
  available: readonly string[],
): string {
  const roster = available.length > 0 ? available : [...FALLBACK_PRESET_IDS]
  const candidates: string[] = []
  if (wanted !== undefined) {
    candidates.push(wanted)
    const alias = LEGACY_PRESET_ALIASES[wanted]
    if (alias !== undefined) candidates.push(alias)
  }
  candidates.push('standard')
  for (const id of candidates) {
    if (roster.includes(id)) return id
  }
  return roster[0] ?? 'standard'
}

/**
 * Preset for a new session: current session's mode when still available, else
 * `standard`, else the first roster entry.
 */
export function resolveAgentPresetForNewSession(
  get: (name: string) => unknown,
  available: readonly string[],
): string {
  return pickAvailablePreset(currentAgentPreset(get), available)
}

export async function listAvailableAgentPresets(
  get: (name: string) => unknown,
): Promise<string[]> {
  const remote = get('remote') as RemoteFace | undefined
  try {
    const result = await remote?.agentPresets?.list()
    if (result?.ok === true) {
      const ids = result.value?.presets.map((preset) => preset.id) ?? []
      if (ids.length > 0) return ids
    }
  } catch {
    // fall through to static fallback
  }
  return [...FALLBACK_PRESET_IDS]
}

/** Mirror DSH `connectWorkspace` blank reuse without forcing a broken default preset. */
export function findReusableBlankSession(
  get: (name: string) => unknown,
  workspaceId: string,
): string | undefined {
  const workspaces = get('workspaces') as WorkspacesFace | undefined
  const sessions = get('sessions') as SessionsFace | undefined
  const workspace = workspaces?.list?.getSnapshot().items
    .find((item) => item.workspaceId === workspaceId)
  if (workspace === undefined || sessions?.list === undefined) return undefined
  const archived = workspaces?.list?.getSnapshot().archivedSessionIds ?? []
  const snap = sessions.list.getSnapshot()
  const ids = snap.ids ?? Object.keys(snap.byId ?? {})
  for (const id of ids) {
    const summary = snap.byId?.[id]
    if (summary === undefined || summary.blank !== true) continue
    if (summary.cwd !== undefined && workspace.path !== undefined && summary.cwd !== workspace.path) {
      continue
    }
    if (!workspace.sessionIds.includes(id)) continue
    if (archived.includes(id)) continue
    return id
  }
  return undefined
}

async function createSessionWithPreset(
  get: (name: string) => unknown,
  workspaceId: string,
  agentPreset: string,
): Promise<string> {
  const remote = get('remote') as RemoteFace | undefined
  if (typeof remote?.session?.create !== 'function') {
    throw new Error('remote.session.create unavailable')
  }
  const result = await remote.session.create({ workspaceId, agentPreset })
  if (!result.ok) throw result.error ?? new Error('session create failed')
  const sessions = get('sessions') as SessionsFace | undefined
  if (typeof sessions?.refresh === 'function') {
    try { await sessions.refresh() } catch { /* list may already be projected */ }
  }
  return result.value?.sessionId ?? ''
}

function resolveUiWorkspace(get: (name: string) => unknown): UiWorkspaceFace | undefined {
  const ui = get('uiWorkspace') as UiWorkspaceFace | undefined
  if (ui !== null && typeof ui === 'object') return ui
  return undefined
}

function canNavigateSessions(
  get: (name: string) => unknown,
  sessions: SessionsFace,
): boolean {
  if (typeof sessions.open === 'function') return true
  return typeof resolveUiWorkspace(get)?.openSession === 'function'
}

/**
 * Create a fresh session and select it. Returns the new id, or undefined on failure.
 * Prefer `uiWorkspace.openSession` for visible navigation (DSH ≥ 0.1.5); fall back
 * to `sessions.open` when openSession is unavailable.
 */
export async function createAndOpenSession(
  get: (name: string) => unknown,
  workspaceId: string,
  agentPreset?: string,
): Promise<string | undefined> {
  const sessions = get('sessions') as SessionsFace | undefined
  if (sessions === undefined) return undefined
  if (!canNavigateSessions(get, sessions)) {
    console.warn('workbench /new: navigation (open/openSession) unavailable')
    return undefined
  }
  try {
    let id: string
    if (agentPreset !== undefined && typeof get('remote') === 'object') {
      id = await createSessionWithPreset(get, workspaceId, agentPreset)
    } else if (typeof sessions.create === 'function') {
      id = await sessions.create({ workspaceId, ...(agentPreset === undefined ? {} : { agentPreset }) })
    } else {
      return undefined
    }
    if (typeof id !== 'string' || id.length === 0) {
      console.warn('workbench /new: sessions.create returned an empty id')
      return undefined
    }
    if (!openCreatedSession(get, sessions, id)) return undefined
    if (sessions.list?.getSnapshot().current === id) return id
    const settled = await waitForCurrentId(sessions, id, OPEN_SETTLE_MS)
    if (settled) return id
    console.warn('workbench /new: current did not switch after open', {
      id,
      current: sessions.list?.getSnapshot().current,
    })
    if (!openCreatedSession(get, sessions, id)) return undefined
    return (await waitForCurrentId(sessions, id, OPEN_SETTLE_MS)) ? id : undefined
  } catch (error) {
    if (isPresetConfigError(error)) throw error
    console.warn('workbench /new: sessions.create failed', error)
    return undefined
  }
}

/** Navigate to `id`. Returns false when no navigation API is available or it throws. */
function openCreatedSession(
  get: (name: string) => unknown,
  sessions: SessionsFace,
  id: string,
): boolean {
  const ui = resolveUiWorkspace(get)
  if (typeof ui?.openSession === 'function') {
    try {
      ui.openSession(id)
    } catch (error) {
      console.warn('workbench /new: uiWorkspace.openSession failed', error)
      return false
    }
    if (typeof sessions.open === 'function') {
      try {
        sessions.open(id)
      } catch (error) {
        console.warn('workbench /new: sessions.open failed after openSession', error)
      }
    }
    return true
  }
  if (typeof sessions.open !== 'function') return false
  try {
    sessions.open(id)
    return true
  } catch (error) {
    console.warn('workbench /new: sessions.open failed', error)
    return false
  }
}

export interface StartNewSessionResult {
  readonly ok: boolean
  readonly sessionId?: string
  /** Short machine hint for logs / toast when ok is false. */
  readonly reason?: string
  /** User-facing error when ok is false; omit to use the generic unavailable copy. */
  readonly userMessage?: string
}

type OpenWorkspaceOutcome =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: string; readonly error?: unknown }

/**
 * Connect like the sidebar, but create with the caller's agent preset instead of
 * the Host settings default (which may reference removed presets such as `code`).
 */
async function connectAndOpenNewSession(
  get: (name: string) => unknown,
  workspaceId: string,
  agentPreset: string,
): Promise<OpenWorkspaceOutcome> {
  const sessions = get('sessions') as SessionsFace | undefined
  if (sessions === undefined) return { ok: false, reason: 'no-sessions' }
  try {
    const blank = findReusableBlankSession(get, workspaceId)
    const sessionId = blank ?? await createSessionWithPreset(get, workspaceId, agentPreset)
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { ok: false, reason: 'no-session-id' }
    }
    if (!openCreatedSession(get, sessions, sessionId)) {
      return { ok: false, reason: 'open-failed' }
    }
    if (sessions.list?.getSnapshot().current !== sessionId) {
      const settled = await waitForCurrentId(sessions, sessionId, OPEN_SETTLE_MS)
      if (!settled) return { ok: false, reason: 'no-switch' }
    }
    return { ok: true, sessionId }
  } catch (error) {
    if (!isPresetConfigError(error)) {
      console.warn('workbench /new: connectAndOpenNewSession failed', error)
    }
    return { ok: false, reason: 'connect-failed', error }
  }
}

/** Legacy harness path when remote.session.create is unavailable. */
async function openWorkspaceSession(
  get: (name: string) => unknown,
  workspaceId: string,
): Promise<OpenWorkspaceOutcome> {
  const ui = resolveUiWorkspace(get)
  if (typeof ui?.openWorkspace !== 'function') {
    return { ok: false, reason: 'no-openWorkspace' }
  }
  let resolvedId: string | undefined
  try {
    await ui.openWorkspace(workspaceId, (sessionId) => { resolvedId = sessionId })
  } catch (error) {
    if (!isPresetConfigError(error)) {
      console.warn('workbench /new: openWorkspace failed', error)
    }
    return { ok: false, reason: 'openWorkspace-failed', error }
  }
  const sessionId = resolvedId ?? currentSessionId(get)
  if (sessionId === undefined) return { ok: false, reason: 'no-session-id' }
  return { ok: true, sessionId }
}

function navigationSettled(
  get: (name: string) => unknown,
  before: string | undefined,
  sessionId: string,
): boolean {
  const current = currentSessionId(get)
  if (current === sessionId) return true
  return current !== undefined && current !== before
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Host rejected session create because the workspace default agent preset is missing. */
export function isPresetConfigError(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('agent-preset/not-found') || /preset "[^"]+" not found/u.test(message)
}

function extractPresetName(message: string): string {
  const presetMatch = /preset "([^"]+)"/u.exec(message)
  return presetMatch?.[1] ?? 'unknown'
}

/** Map host create failures to user-facing copy when we can identify the cause. */
export function formatSessionStartError(
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | undefined {
  const message = errorMessage(error)
  if (!isPresetConfigError(error)) return undefined
  return t('new.presetNotFound', { preset: extractPresetName(message) })
}

function presetFailure(
  error: unknown,
  translate: (key: string, vars?: Record<string, string | number>) => string,
): StartNewSessionResult {
  return {
    ok: false,
    reason: 'preset-not-found',
    userMessage: formatSessionStartError(error, translate) ?? translate('new.unavailable'),
  }
}

/**
 * Start a blank session in the current workspace and, when `initialText` is
 * non-empty, send it as the first message once the new session is current.
 *
 * Prefer `uiWorkspace.openWorkspace` (sidebar parity — reuses blank sessions).
 * Fall back to force-create via `sessions.create` when openWorkspace is absent.
 */
export async function startNewSession(
  get: (name: string) => unknown,
  initialText = '',
  t?: (key: string, vars?: Record<string, string | number>) => string,
): Promise<StartNewSessionResult> {
  const translate = t ?? ((_key, vars) => vars?.detail as string ?? '')
  let lastError: unknown
  try {
    const text = initialText.trim()
    const before = currentSessionId(get)
    const workspaceId = resolveTargetWorkspaceId(get)

    if (workspaceId !== undefined) {
      const available = await listAvailableAgentPresets(get)
      const agentPreset = resolveAgentPresetForNewSession(get, available)
      const opened = await connectAndOpenNewSession(get, workspaceId, agentPreset)
      if (opened.ok) {
        const { sessionId } = opened
        const settled = navigationSettled(get, before, sessionId)
        if (text.length === 0 || settled || sessionId === before) {
          if (text.length > 0) void sendFirstMessageToSession(get, text, sessionId)
          return { ok: true, sessionId }
        }
        return { ok: false, reason: 'no-switch' }
      }
      if (opened.error !== undefined && isPresetConfigError(opened.error)) {
        return presetFailure(opened.error, translate)
      }
      lastError = opened.error

      const legacy = await openWorkspaceSession(get, workspaceId)
      if (legacy.ok) {
        const { sessionId } = legacy
        const settled = navigationSettled(get, before, sessionId)
        if (text.length === 0 || settled || sessionId === before) {
          if (text.length > 0) void sendFirstMessageToSession(get, text, sessionId)
          return { ok: true, sessionId }
        }
      } else if (legacy.error !== undefined) {
        lastError = legacy.error
      }

      try {
        const sessionId = await createAndOpenSession(get, workspaceId, agentPreset)
        if (sessionId !== undefined) {
          const settled = navigationSettled(get, before, sessionId)
          if (text.length === 0 || settled || sessionId === before) {
            if (text.length > 0) void sendFirstMessageToSession(get, text, sessionId)
            return { ok: true, sessionId }
          }
          return { ok: false, reason: 'no-switch' }
        }
      } catch (error) {
        if (isPresetConfigError(error)) return presetFailure(error, translate)
        throw error
      }
    }

    if (lastError !== undefined && isPresetConfigError(lastError)) {
      return presetFailure(lastError, translate)
    }

    const ui = resolveUiWorkspace(get)
    const legacy = get('workspaces') as UiWorkspaceFace | undefined
    const starter = (typeof ui?.startSession === 'function' ? ui : undefined)
      ?? (typeof legacy?.startSession === 'function' ? legacy : undefined)
    if (starter === undefined || typeof starter.startSession !== 'function') {
      const userMessage = formatSessionStartError(lastError, translate)
      return {
        ok: false,
        reason: workspaceId === undefined ? 'no-workspace' : 'no-startSession',
        userMessage,
      }
    }
    if (workspaceId !== undefined) starter.startSession(workspaceId)
    else starter.startSession()

    const switched = await waitForCurrentChange(get, before)
    if (text.length > 0) {
      if (switched === undefined) {
        const userMessage = formatSessionStartError(lastError, translate)
        return { ok: false, reason: 'no-switch', userMessage }
      }
      void sendFirstMessageToSession(get, text, switched)
      return { ok: true, sessionId: switched }
    }
    return { ok: true, sessionId: switched ?? before }
  } catch (error) {
    console.warn('workbench /new: startNewSession threw', error)
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'threw',
      userMessage: formatSessionStartError(error, translate),
    }
  }
}

const NEW_SESSION_WAIT_MS = 3000
const NEW_SESSION_POLL_MS = 30
/** Short window for list.current to reflect a just-issued open/select. */
const OPEN_SETTLE_MS = 800

async function waitForCurrentId(
  sessions: SessionsFace,
  id: string,
  budgetMs: number,
): Promise<boolean> {
  const list = sessions.list
  if (list === undefined) return false
  if (list.getSnapshot().current === id) return true
  if (typeof list.subscribe === 'function') {
    return new Promise((resolve) => {
      let unsubscribe: () => void = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe()
        resolve(ok)
      }
      unsubscribe = list.subscribe(() => {
        if (list.getSnapshot().current === id) finish(true)
      })
      timer = setTimeout(() => finish(list.getSnapshot().current === id), budgetMs)
      if (list.getSnapshot().current === id) finish(true)
    })
  }
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (list.getSnapshot().current === id) return true
    await new Promise<void>((resolve) => setTimeout(resolve, NEW_SESSION_POLL_MS))
  }
  return list.getSnapshot().current === id
}

async function waitForCurrentChange(
  get: (name: string) => unknown,
  before: string | undefined,
): Promise<string | undefined> {
  const sessions = get('sessions') as SessionsFace | undefined
  const list = sessions?.list
  if (list === undefined) return undefined
  if (typeof list.subscribe === 'function') {
    return new Promise((resolve) => {
      let unsubscribe: () => void = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (id: string | undefined): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe()
        resolve(id)
      }
      const check = (): void => {
        const current = list.getSnapshot().current
        if (current !== undefined && current !== before) finish(current)
      }
      unsubscribe = list.subscribe(check)
      timer = setTimeout(() => finish(undefined), NEW_SESSION_WAIT_MS)
      check()
    })
  }
  const deadline = Date.now() + NEW_SESSION_WAIT_MS
  while (Date.now() < deadline) {
    const current = list.getSnapshot().current
    if (current !== undefined && current !== before) return current
    await new Promise<void>((resolve) => setTimeout(resolve, NEW_SESSION_POLL_MS))
  }
  return undefined
}

async function sendFirstMessageToSession(
  get: (name: string) => unknown,
  text: string,
  sessionId: string,
): Promise<void> {
  const sessions = get('sessions') as SessionsFace | undefined
  if (sessions === undefined || typeof sessions.binding !== 'function') return
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) {
    console.warn('workbench /new: target session not addressable; first message not sent', sessionId)
    return
  }
  try {
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) console.warn('workbench /new: first message rejected', result)
  } catch (error) {
    console.warn('workbench /new: first message failed', error)
  }
}

/** Claim submit outcome the composer turns into a notice. */
export interface NewSessionSubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

const NEW_SESSION_PREVIEW_CHARS = 200

function previewText(text: string): string {
  if (text.length <= NEW_SESSION_PREVIEW_CHARS) return text
  return `${text.slice(0, NEW_SESSION_PREVIEW_CHARS)}…`
}

/**
 * The `/new` command claim: token `/new ` + the ghost hint shown while the
 * args are blank (`<第一句话，可空>`), and the submit transaction that starts
 * the session and sends the first message. The first message is the typed
 * trailing text when present, otherwise the configured `/new` default prompt
 * (empty = blank session).
 */
function newClaim(
  get: (name: string) => unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
  readDefault: () => string,
): { token: string; hint: string; submit: (args: string) => Promise<NewSessionSubmitOutcome> } {
  return {
    token: `/${NEW_COMMAND_NAME} `,
    hint: t('new.hint'),
    submit: async (args): Promise<NewSessionSubmitOutcome> => {
      const trimmed = args.trim()
      const text = trimmed.length > 0 ? trimmed : readDefault().trim()
      const started = await startNewSession(get, text, t)
      if (!started.ok) {
        if (started.userMessage === undefined) {
          console.warn('workbench /new: claim submit unavailable', started.reason)
        }
        return {
          kind: 'error',
          text: started.userMessage ?? t('new.unavailable'),
        }
      }
      if (text.length === 0) return { kind: 'success', text: t('new.ok') }
      return { kind: 'success', text: t('new.started', { quoted: previewText(text) }) }
    },
  }
}

/**
 * Space adjudication for `/new`: claiming here (token `/new` completed by a
 * space) applies `/new ` to the draft and shows the ghost hint, so the first
 * message reads like `/steer <guidance>`. The command source never claims
 * `/new` (no host `input`), so this source answers for it.
 */
export function newSlashMatchSpace(
  get: (name: string) => unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
  readDefault: () => string = () => '',
): NonNullable<SlashSource['matchSpace']> {
  return (_session, token) => {
    if (token !== `/${NEW_COMMAND_NAME}`) return undefined
    return { claim: newClaim(get, t, readDefault) }
  }
}

/**
 * `/new <text>` claim for the plugin's own `/` source: one Enter submits the
 * trailing text, starts a new session, and sends it as the first message.
 * Bare `/new` is left to DSH's command source (detached execute + event),
 * which runs first in adjudication order.
 */
export function newSlashMatchEnter(
  get: (name: string) => unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
  readDefault: () => string = () => '',
): NonNullable<SlashSource['matchEnter']> {
  return async (_session, line, signal) => {
    if (signal.aborted) return undefined
    if (leadingCommandName(line) !== NEW_COMMAND_NAME) return undefined
    // Bare `/new` (no args after trim) stays on the command source + command/executed.
    if (line.trim() === `/${NEW_COMMAND_NAME}`) return undefined
    return { claim: newClaim(get, t, readDefault) }
  }
}

function wrapCommandSource(source: SlashSource, start: (initialText: string) => void): () => void {
  if (source.trigger !== '/' || source.name !== 'command') return () => {}
  const originalOnPick = source.onPick
  const originalMatchEnter = source.matchEnter
  source.onPick = (pick) => {
    const outcome = originalOnPick.call(source, pick)
    const name = (pick as { candidate?: { name?: string } } | null)?.candidate?.name
    if (name === NEW_COMMAND_NAME) start('')
    return outcome
  }
  if (originalMatchEnter !== undefined) {
    source.matchEnter = async (session, line, signal) => {
      const outcome = await originalMatchEnter.call(source, session, line, signal)
      if (leadingCommandName(line) === NEW_COMMAND_NAME && outcome !== undefined) {
        start(leadingCommandInput(line))
      }
      return outcome
    }
  }
  return () => {
    source.onPick = originalOnPick
    source.matchEnter = originalMatchEnter
  }
}

/**
 * After the host `/new` command is claimed (bare `/new` or a menu pick),
 * switch the visible session. Prefer {@link installNewSessionFromCommandEvent}
 * in production; this bridge remains for tests and older wiring.
 */
export function installNewSessionBridge(
  service: SlashTriggerService,
  start: (initialText: string) => void,
): () => void {
  const undo: Array<() => void> = []
  const wrap = (source: SlashSource): void => {
    undo.push(wrapCommandSource(source, start))
  }
  for (const source of service.live?.sources ?? []) wrap(source)
  const originalRegister = service.registerSource
  service.registerSource = (source) => {
    wrap(source)
    return originalRegister.call(service, source)
  }
  return () => {
    service.registerSource = originalRegister
    while (undo.length > 0) undo.pop()?.()
  }
}
