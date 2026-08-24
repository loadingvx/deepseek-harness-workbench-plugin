/**
 * Poll the host Canvas open queue and invoke {@link onOpen} for new paths.
 */
import type { GitClient } from '../api.ts'
import type { CanvasOpenSnapshot } from '../../shared/types.ts'

const POLL_MS = 1500

let liveClient: GitClient | null = null
let liveWorkspace: string | undefined
let lastSeq = 0
let refs = 0
let timer = 0
let gen = 0
let onOpen: ((path: string) => void) | null = null

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

async function load(): Promise<void> {
  const client = liveClient
  const workspaceId = liveWorkspace
  const open = onOpen
  if (client === null || workspaceId === undefined || open === null || hidden()) return
  const token = ++gen
  const result = await client.canvasOpenQueue(workspaceId, lastSeq)
  if (token !== gen || !result.ok) return
  applySnapshot(result.value, open)
}

function applySnapshot(snap: CanvasOpenSnapshot, open: (path: string) => void): void {
  if (snap.opens.length === 0) return
  for (const row of snap.opens) {
    if (row.seq <= lastSeq) continue
    open(row.path)
    lastSeq = Math.max(lastSeq, row.seq)
  }
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

/** SideDock / Workbench mount; refcount stops polling at zero. */
export function retainCanvasLive(
  client: GitClient,
  workspaceId: string | undefined,
  open: (path: string) => void,
): () => void {
  liveClient = client
  const wsChanged = liveWorkspace !== workspaceId
  liveWorkspace = workspaceId
  onOpen = open
  refs += 1

  if (refs === 1) startTimer()
  if (wsChanged) {
    gen += 1
    lastSeq = 0
    if (workspaceId !== undefined) void load()
  } else if (refs === 1 && workspaceId !== undefined) {
    void load()
  }

  return () => {
    refs -= 1
    if (refs > 0) return
    refs = 0
    gen += 1
    stopTimer()
    liveClient = null
    liveWorkspace = undefined
    onOpen = null
    lastSeq = 0
  }
}

/** Test hook: apply a snapshot without polling. */
export function __testApplyCanvasOpenSnapshot(
  snap: CanvasOpenSnapshot,
  open: (path: string) => void,
): void {
  applySnapshot(snap, open)
}
