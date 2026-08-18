import { NEW_COMMAND_NAME } from '../../shared/ultra-slash/ids.ts'
import type { SlashSource, SlashTriggerService } from './slash-menu.ts'

export function leadingCommandName(line: string): string | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line.trim())
  return match?.[1]
}

export function startNewSession(get: (name: string) => unknown): boolean {
  const workspaces = get('workspaces') as { startSession?: (workspaceId?: string) => void } | undefined
  if (workspaces === undefined || typeof workspaces.startSession !== 'function') return false
  workspaces.startSession()
  return true
}

function wrapCommandSource(source: SlashSource, start: () => void): () => void {
  if (source.trigger !== '/' || source.name !== 'command') return () => {}
  const originalOnPick = source.onPick
  const originalMatchEnter = source.matchEnter
  source.onPick = (pick) => {
    const outcome = originalOnPick.call(source, pick)
    const name = (pick as { candidate?: { name?: string } } | null)?.candidate?.name
    if (name === NEW_COMMAND_NAME) start()
    return outcome
  }
  if (originalMatchEnter !== undefined) {
    source.matchEnter = async (session, line, signal) => {
      const outcome = await originalMatchEnter.call(source, session, line, signal)
      if (leadingCommandName(line) === NEW_COMMAND_NAME && outcome !== undefined) start()
      return outcome
    }
  }
  return () => {
    source.onPick = originalOnPick
    source.matchEnter = originalMatchEnter
  }
}

/**
 * After the host `/new` command is claimed, switch the visible session.
 * Does not cancel a running turn — same as the sidebar「新会话」button.
 */
export function installNewSessionBridge(
  service: SlashTriggerService,
  start: () => void,
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
