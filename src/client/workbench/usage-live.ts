import type { GitClient } from '../api.ts'
import type { ProviderUsageSnapshot } from '../../shared/types.ts'

const POLL_MS = 60_000

let snapshot: ProviderUsageSnapshot | null = null
let liveClient: GitClient | null = null
/** Session id used for pulls — always tracks {@link bindUsageLiveSession}. */
let liveSession: string | undefined
/** Harness `sessions.current`; retain() must not override this with a stale Workbench sessionId. */
let boundSession: string | undefined
let bound = false
let refs = 0
let timer = 0
let pullGen = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function adoptSession(next: string | undefined): void {
  if (liveSession === next) return
  liveSession = next
  snapshot = null
  pullGen += 1
  emit()
  if (refs > 0 && liveClient !== null) void pull()
}

export function readUsageLive(): ProviderUsageSnapshot | null {
  return snapshot
}

export function readUsageLiveSession(): string | undefined {
  return liveSession
}

export function subscribeUsageLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Pin usage polling to harness `sessions.current`.
 * Call from Workbench whenever the global current session changes.
 */
export function bindUsageLiveSession(sessionId: string | undefined): void {
  bound = true
  if (boundSession === sessionId && liveSession === sessionId) return
  boundSession = sessionId
  adoptSession(sessionId)
}

async function pull(): Promise<void> {
  const client = liveClient
  if (client === null) return
  const gen = ++pullGen
  const sessionId = liveSession
  const result = await client.usage(sessionId)
  if (gen !== pullGen) return
  if (result.ok) snapshot = result.value
  emit()
}

export function refreshUsageLive(): Promise<void> {
  return pull()
}

/**
 * Keep account balance polling alive while the status bar or usage panel is mounted.
 * `sessionId` is only used before the first {@link bindUsageLiveSession}; afterwards
 * the bound current session always wins so stale Workbench mounts cannot clobber it.
 */
export function retainUsageLive(client: GitClient, sessionId?: string): () => void {
  liveClient = client
  refs += 1
  const target = bound ? boundSession : sessionId
  if (liveSession !== target) {
    liveSession = target
    snapshot = null
    pullGen += 1
    emit()
    void pull()
  } else if (refs === 1 && snapshot === null) {
    void pull()
  }
  if (refs === 1) {
    timer = window.setInterval(() => { void pull() }, POLL_MS)
  }
  return () => {
    refs -= 1
    if (refs > 0) return
    refs = 0
    pullGen += 1
    if (timer !== 0) {
      window.clearInterval(timer)
      timer = 0
    }
  }
}

/** Test-only reset between cases. */
export function resetUsageLiveForTests(): void {
  snapshot = null
  liveClient = null
  liveSession = undefined
  boundSession = undefined
  bound = false
  refs = 0
  pullGen += 1
  if (timer !== 0) {
    window.clearInterval(timer)
    timer = 0
  }
  emit()
}
