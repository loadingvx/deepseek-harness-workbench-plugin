/**
 * 共享 Git 状态轮询：StatusBar 与 GitSidebar 共用同一组定时器，避免重复请求。
 *
 * - 8s：git status（工作区改动、分支、ahead/behind）
 * - 60s：git fetch --prune + 重新 status（仅在有 remote 时）
 * - 页面隐藏时跳过
 *
 * branches / log 仍由 GitSidebar 在挂载、写操作、手动刷新时单独加载。
 */
import type { GitClient } from '../api.ts'
import type { GitStatusSnapshot } from '../../shared/types.ts'

const STATUS_POLL_MS = 8000
const FETCH_POLL_MS = 60_000

let liveClient: GitClient | null = null
let liveWorkspace: string | undefined
let liveRepoId = '.'
let status: GitStatusSnapshot | null = null
let hasRemote = false
let refs = 0
let statusTimer = 0
let fetchTimer = 0
let statusGen = 0
let fetchGen = 0
let paused = 0

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function readGitLiveStatus(): GitStatusSnapshot | null {
  return status
}

export function subscribeGitLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Git 写操作期间暂停轮询，避免读到半途中状态。 */
export function pauseGitLive(): () => void {
  paused += 1
  return () => { paused = Math.max(0, paused - 1) }
}

async function loadStatus(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  if (client === null || workspaceId === undefined || paused > 0 || hidden()) return
  const gen = ++statusGen
  const result = await client.status(workspaceId, liveRepoId)
  if (gen !== statusGen) return
  if (!result.ok) {
    if (result.code === 'BUSY') return
    status = null
    hasRemote = false
    emit()
    return
  }
  status = result.value
  hasRemote = result.value.probe.remote !== undefined
  emit()
}

async function fetchRemote(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  if (client === null || workspaceId === undefined || !hasRemote || paused > 0 || hidden()) return
  const gen = ++fetchGen
  const result = await client.fetch(workspaceId, liveRepoId)
  if (gen !== fetchGen || !result.ok) return
  await loadStatus()
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void fetchRemote()
}

function startTimers(): void {
  if (statusTimer !== 0) return
  statusTimer = window.setInterval(() => { void loadStatus() }, STATUS_POLL_MS)
  fetchTimer = window.setInterval(() => { void fetchRemote() }, FETCH_POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
}

function stopTimers(): void {
  if (statusTimer !== 0) {
    window.clearInterval(statusTimer)
    statusTimer = 0
  }
  if (fetchTimer !== 0) {
    window.clearInterval(fetchTimer)
    fetchTimer = 0
  }
  document.removeEventListener('visibilitychange', onVisible)
}

function bootstrap(): void {
  if (liveWorkspace === undefined) return
  void loadStatus().then(() => {
    if (hasRemote) void fetchRemote()
  })
}

/** StatusBar / GitSidebar 挂载时调用；引用计数归零后停止轮询。 */
export function retainGitLive(client: GitClient, workspaceId?: string, repoId = '.'): () => void {
  liveClient = client
  const wsChanged = liveWorkspace !== workspaceId
  const repoChanged = liveRepoId !== repoId
  liveWorkspace = workspaceId
  liveRepoId = repoId
  refs += 1

  if (wsChanged || repoChanged) {
    statusGen += 1
    fetchGen += 1
    status = null
    hasRemote = false
    emit()
    bootstrap()
  } else if (refs === 1 && status === null) {
    bootstrap()
  }

  if (refs === 1) startTimers()

  return () => {
    refs -= 1
    if (refs > 0) return
    refs = 0
    statusGen += 1
    fetchGen += 1
    stopTimers()
    liveClient = null
    liveWorkspace = undefined
    liveRepoId = '.'
    status = null
    hasRemote = false
    emit()
  }
}

export function refreshGitLiveStatus(): Promise<void> {
  return loadStatus()
}

export function refreshGitLiveRemote(): Promise<void> {
  return fetchRemote()
}
