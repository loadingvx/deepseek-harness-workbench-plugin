/**
 * Shared Agent-review pending poll so the side-dock tab can appear only when
 * there is something to Keep / Undo (empty queue hides the tab).
 *
 * Respects the Change review preference: when off, snapshot stays empty and
 * the host is told to stop capturing baselines.
 */
import type { GitClient } from '../api.ts'
import type { ReviewSnapshot } from '../../shared/types.ts'
import {
  bindReviewHostSync,
  getReviewOn,
  subscribeReviewOn,
} from './review-settings.ts'

const POLL_MS = 2000

const EMPTY: ReviewSnapshot = { revision: 0, files: [] }

let liveClient: GitClient | null = null
let liveWorkspace: string | undefined
let snap: ReviewSnapshot = EMPTY
let refs = 0
let timer = 0
let gen = 0
let unbindHost: (() => void) | null = null
let unsubPref: (() => void) | null = null

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function readReviewLive(): ReviewSnapshot {
  return getReviewOn() ? snap : EMPTY
}

export function readReviewPendingCount(): number {
  return readReviewLive().files.length
}

export function subscribeReviewLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function load(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  if (client === null || workspaceId === undefined || hidden()) return
  if (!getReviewOn()) {
    if (snap.files.length > 0 || snap.revision !== 0) {
      snap = EMPTY
      emit()
    }
    return
  }
  const token = ++gen
  const result = await client.reviewList(workspaceId)
  if (token !== gen) return
  if (!result.ok) {
    snap = EMPTY
    emit()
    return
  }
  snap = result.value
  emit()
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void load()
}

function startTimer(): void {
  if (timer !== 0) return
  timer = window.setInterval(() => { void load() }, POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
}

function stopTimer(): void {
  if (timer !== 0) {
    window.clearInterval(timer)
    timer = 0
  }
  document.removeEventListener('visibilitychange', onVisible)
}

/** Apply a Keep/Undo response immediately so the tab can hide without waiting for poll. */
export function applyReviewLiveSnapshot(next: ReviewSnapshot): void {
  snap = getReviewOn() ? next : EMPTY
  emit()
}

export function refreshReviewLive(): Promise<void> {
  return load()
}

/** SideDock / ReviewPanel / Workbench mount; refcount stops polling at zero. */
export function retainReviewLive(client: GitClient, workspaceId?: string): () => void {
  liveClient = client
  const wsChanged = liveWorkspace !== workspaceId
  liveWorkspace = workspaceId
  refs += 1

  if (refs === 1) {
    unbindHost = bindReviewHostSync((enabled) => {
      const c = liveClient
      if (c === null) return
      void c.reviewSetEnabled(enabled).then(() => {
        if (!enabled) {
          snap = EMPTY
          emit()
          return
        }
        void load()
      })
    })
    unsubPref = subscribeReviewOn(() => {
      emit()
      void load()
    })
    startTimer()
  }

  if (wsChanged) {
    gen += 1
    snap = EMPTY
    emit()
    if (workspaceId !== undefined && getReviewOn()) void load()
  } else if (refs === 1 && snap.files.length === 0 && workspaceId !== undefined && getReviewOn()) {
    void load()
  }

  return () => {
    refs -= 1
    if (refs > 0) return
    refs = 0
    gen += 1
    stopTimer()
    unbindHost?.()
    unbindHost = null
    unsubPref?.()
    unsubPref = null
    liveClient = null
    liveWorkspace = undefined
    snap = EMPTY
    emit()
  }
}
