/**
 * 共享 Git 状态轮询：StatusBar 与 GitSidebar 共用同一组定时器，避免重复请求。
 *
 * - 8s：git status（工作区改动、分支、ahead/behind）
 * - 自动 fetch：间隔由 Git 设置（默认 60 分钟）；仅在有 remote 时
 * - 上一次 fetch 未完成时跳过，避免叠跑
 * - fetch 失败时退避：下次等待 ≥ max(配置间隔, 本次耗时 × 2)
 * - 页面隐藏时跳过
 *
 * branches / log 仍由 GitSidebar 在挂载、写操作、手动刷新时单独加载。
 */
import type { GitClient } from '../api.ts'
import type { GitStatusSnapshot } from '../../shared/types.ts'
import { autoFetchMinutesToMs, nextAutoFetchDelayMs } from '../../shared/git-auto-fetch.ts'
import { readGitSyncPrefs } from '../../shared/git-sync-prefs.ts'

const STATUS_POLL_MS = 8000

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
/** 上一次自动 fetch 仍在进行时禁止再启。 */
let fetchBusy = false

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function configuredFetchMs(): number {
  return autoFetchMinutesToMs(readGitSyncPrefs().autoFetchMinutes)
}

function clearFetchTimer(): void {
  if (fetchTimer !== 0) {
    window.clearTimeout(fetchTimer)
    fetchTimer = 0
  }
}

function scheduleFetch(delayMs: number): void {
  clearFetchTimer()
  if (delayMs <= 0 || refs <= 0) return
  fetchTimer = window.setTimeout(() => {
    fetchTimer = 0
    void fetchRemote()
  }, delayMs)
}

/** 按当前偏好重排自动 fetch（设置保存后调用）。 */
export function applyGitLiveFetchInterval(): void {
  const ms = configuredFetchMs()
  if (ms <= 0) {
    clearFetchTimer()
    return
  }
  if (fetchBusy) return
  scheduleFetch(ms)
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
  const hadRemote = hasRemote
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
  if (!hadRemote && hasRemote && !fetchBusy && fetchTimer === 0) {
    scheduleFetch(0)
  }
}

async function fetchRemote(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  if (client === null || workspaceId === undefined || !hasRemote || paused > 0 || hidden()) {
    scheduleFetch(configuredFetchMs())
    return
  }
  if (fetchBusy) return

  fetchBusy = true
  const gen = ++fetchGen
  const started = Date.now()
  let failed = false
  try {
    const result = await client.fetch(workspaceId, liveRepoId)
    if (gen !== fetchGen) return
    failed = !result.ok
    if (!failed) await loadStatus()
  } catch {
    if (gen !== fetchGen) return
    failed = true
  } finally {
    if (gen === fetchGen) {
      const durationMs = Date.now() - started
      fetchBusy = false
      const delay = nextAutoFetchDelayMs(configuredFetchMs(), failed, durationMs)
      scheduleFetch(delay)
    } else {
      fetchBusy = false
    }
  }
}

function onVisible(): void {
  if (document.visibilityState !== 'visible') return
  if (configuredFetchMs() <= 0) return
  if (fetchBusy) return
  void fetchRemote()
}

function startTimers(): void {
  if (statusTimer !== 0) return
  statusTimer = window.setInterval(() => { void loadStatus() }, STATUS_POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
  const ms = configuredFetchMs()
  if (ms > 0) scheduleFetch(ms)
}

function stopTimers(): void {
  if (statusTimer !== 0) {
    window.clearInterval(statusTimer)
    statusTimer = 0
  }
  clearFetchTimer()
  document.removeEventListener('visibilitychange', onVisible)
}

function bootstrap(): void {
  if (liveWorkspace === undefined) return
  void loadStatus().then(() => {
    if (hasRemote && configuredFetchMs() > 0) void fetchRemote()
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
    fetchBusy = false
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
    fetchBusy = false
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
