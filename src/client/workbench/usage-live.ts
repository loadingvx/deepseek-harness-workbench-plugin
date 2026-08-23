import type { GitClient } from '../api.ts'
import type { ProviderUsageSnapshot } from '../../shared/types.ts'

const POLL_MS = 60_000

let snapshot: ProviderUsageSnapshot | null = null
let liveClient: GitClient | null = null
let liveSession: string | undefined
let refs = 0
let timer = 0
let pullGen = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function readUsageLive(): ProviderUsageSnapshot | null {
  return snapshot
}

export function subscribeUsageLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
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

/** Keep account balance polling alive while the status bar or usage panel is mounted. */
export function retainUsageLive(client: GitClient, sessionId?: string): () => void {
  liveClient = client
  const sessionChanged = liveSession !== sessionId
  liveSession = sessionId
  refs += 1
  if (sessionChanged) {
    snapshot = null
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
