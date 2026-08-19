import { NEW_COMMAND_NAME } from '../../shared/ultra-slash/ids.ts'
import type { SlashSource, SlashTriggerService } from './slash-menu.ts'

/** One message we can queue into a session (structural slice of `sessions.binding`). */
interface SessionPromptFace {
  prompt(
    content: Array<{ type: string; text: string }>,
    mode: 'queue' | 'steer',
  ): Promise<{ ok: boolean }>
}

/** Structural slice of the client `sessions` service used to address the new session. */
interface SessionsFace {
  list?: {
    getSnapshot(): { current?: string }
    subscribe?(fn: () => void): () => void
  }
  binding(id: string): { session?: SessionPromptFace } | undefined
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
 * Start a blank session in the current workspace and, when `initialText` is
 * non-empty, send it as the first message once the new session is current.
 * @returns whether the `workspaces` service was available.
 */
export function startNewSession(get: (name: string) => unknown, initialText = ''): boolean {
  const workspaces = get('workspaces') as { startSession?: (workspaceId?: string) => void } | undefined
  if (workspaces === undefined || typeof workspaces.startSession !== 'function') return false
  const text = initialText.trim()
  const before = text.length > 0 ? currentSessionId(get) : undefined
  workspaces.startSession()
  if (text.length > 0) void sendFirstMessage(get, text, before)
  return true
}

const NEW_SESSION_WAIT_MS = 3000
const NEW_SESSION_POLL_MS = 30

/** Resolve the new session (current changed away from `before`) within the timeout. */
async function waitForNewSession(
  sessions: SessionsFace,
  before: string | undefined,
): Promise<SessionPromptFace | undefined> {
  const list = sessions.list
  if (list === undefined || typeof list.subscribe !== 'function') {
    const deadline = Date.now() + NEW_SESSION_WAIT_MS
    while (Date.now() < deadline) {
      const current = list?.getSnapshot().current
      if (current !== undefined && current !== before) {
        const bound = sessions.binding(current)
        if (bound?.session !== undefined) return bound.session
      }
      await new Promise<void>((resolve) => setTimeout(resolve, NEW_SESSION_POLL_MS))
    }
    return undefined
  }
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (session: SessionPromptFace | undefined): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      resolve(session)
    }
    const check = (): void => {
      if (settled) return
      const current = list.getSnapshot().current
      if (current === undefined || current === before) return
      const bound = sessions.binding(current)
      if (bound?.session === undefined) return
      finish(bound.session)
    }
    unsubscribe = list.subscribe(check)
    timer = setTimeout(() => finish(undefined), NEW_SESSION_WAIT_MS)
    check()
  })
}

async function sendFirstMessage(
  get: (name: string) => unknown,
  text: string,
  before: string | undefined,
): Promise<void> {
  const sessions = get('sessions') as SessionsFace | undefined
  if (sessions === undefined || typeof sessions.binding !== 'function') return
  const session = await waitForNewSession(sessions, before)
  if (session === undefined) {
    console.warn('workbench /new: new session did not become current in time; first message not sent')
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
 * `/new <text>` claim for the plugin's own `/` source: one Enter submits the
 * trailing text, starts a new session, and sends it as the first message.
 * Bare `/new` is left to DSH's command source (detached execute + bridge),
 * which runs first in adjudication order.
 */
export function newSlashMatchEnter(
  get: (name: string) => unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): NonNullable<SlashSource['matchEnter']> {
  return async (_session, line, signal) => {
    if (signal.aborted) return undefined
    if (leadingCommandName(line) !== NEW_COMMAND_NAME) return undefined
    const text = leadingCommandInput(line)
    return {
      claim: {
        token: `/${NEW_COMMAND_NAME} `,
        hint: t('new.hint'),
        submit: async (args): Promise<NewSessionSubmitOutcome> => {
          const trimmed = args.trim()
          if (!startNewSession(get, trimmed)) {
            return { kind: 'error', text: t('new.unavailable') }
          }
          if (trimmed.length === 0) return { kind: 'success', text: t('new.ok') }
          return { kind: 'success', text: t('new.started', { quoted: previewText(trimmed) }) }
        },
      },
    }
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
 * switch the visible session. `/new <text>` never reaches this bridge — the
 * plugin's own slash source claims it and passes the text to {@link startNewSession}.
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
