import type { GitClient } from '../api.ts'
import {
  CURRENT_REPO_ID, PARENT_REPO_ID, pickNearbyRepoId, visibleNearbyRepos,
} from '../../shared/git-nearby.ts'
import type { NearbyGitRepo, NearbyGitSnapshot, ParentGitDecision } from '../../shared/types.ts'

const POLL_MS = 8000
const SELECTED_KEY = 'dsh-workbench-git-repo:'
const PARENT_KEY = 'dsh-workbench-git-parent:'

export interface NearbyGitState {
  snapshot: NearbyGitSnapshot | null
  selectedId: string
  parentDecision: ParentGitDecision | null
}

let state: NearbyGitState = { snapshot: null, selectedId: CURRENT_REPO_ID, parentDecision: null }
let liveClient: GitClient | null = null
let liveWorkspace: string | undefined
let refs = 0
let timer = 0
let pullGen = 0
let abort: AbortController | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeFlag(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

function loadParentDecision(workspaceId: string): ParentGitDecision | null {
  const raw = readFlag(PARENT_KEY + workspaceId)
  return raw === 'include' || raw === 'skip' ? raw : null
}

function loadSelected(workspaceId: string): string {
  return readFlag(SELECTED_KEY + workspaceId) ?? CURRENT_REPO_ID
}

export function readNearbyGit(): NearbyGitState {
  return state
}

export function subscribeNearbyGit(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function nearbyRepoList(current: NearbyGitState = state): NearbyGitRepo[] {
  return visibleNearbyRepos(current.snapshot, current.parentDecision)
}

function applySnapshot(snapshot: NearbyGitSnapshot, workspaceId: string): void {
  const decision = state.parentDecision
  const visible = visibleNearbyRepos(snapshot, decision)
  const selectedId = pickNearbyRepoId(visible, state.selectedId)
  state = { snapshot, selectedId, parentDecision: decision }
  writeFlag(SELECTED_KEY + workspaceId, selectedId)
  emit()
}

async function pull(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  if (client === null || workspaceId === undefined) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  abort?.abort()
  const controller = new AbortController()
  abort = controller
  const gen = ++pullGen
  const result = await client.nearby(workspaceId, controller.signal)
  if (gen !== pullGen || controller.signal.aborted) return
  if (!result.ok) return
  applySnapshot(result.value, workspaceId)
}

export function setNearbyRepo(id: string): void {
  const workspaceId = liveWorkspace
  const selectedId = pickNearbyRepoId(nearbyRepoList(), id)
  if (selectedId === state.selectedId) return
  state = { ...state, selectedId }
  if (workspaceId !== undefined) writeFlag(SELECTED_KEY + workspaceId, selectedId)
  emit()
}

export function setParentGitDecision(decision: ParentGitDecision): void {
  const workspaceId = liveWorkspace
  state = { ...state, parentDecision: decision }
  if (workspaceId !== undefined) writeFlag(PARENT_KEY + workspaceId, decision)
  if (state.snapshot !== null && workspaceId !== undefined) applySnapshot(state.snapshot, workspaceId)
  else emit()
}

/** Keep nearby-repo scanning alive while the status bar or git sidebar is mounted. */
export function retainNearbyGit(client: GitClient, workspaceId?: string): () => void {
  liveClient = client
  const workspaceChanged = liveWorkspace !== workspaceId
  liveWorkspace = workspaceId
  refs += 1
  if (workspaceChanged) {
    abort?.abort()
    abort = null
    pullGen += 1
    const parentDecision = workspaceId === undefined ? null : loadParentDecision(workspaceId)
    const saved = workspaceId === undefined ? CURRENT_REPO_ID : loadSelected(workspaceId)
    state = {
      snapshot: null,
      selectedId: parentDecision !== 'include' && saved === PARENT_REPO_ID ? CURRENT_REPO_ID : saved,
      parentDecision,
    }
    emit()
    if (workspaceId !== undefined) void pull()
  } else if (refs === 1 && state.snapshot === null && workspaceId !== undefined) {
    void pull()
  }
  if (refs === 1) {
    timer = window.setInterval(() => { void pull() }, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    refs -= 1
    if (refs > 0) return
    refs = 0
    pullGen += 1
    abort?.abort()
    abort = null
    if (timer !== 0) {
      window.clearInterval(timer)
      timer = 0
    }
    document.removeEventListener('visibilitychange', onVisible)
    liveClient = null
    liveWorkspace = undefined
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void pull()
}
