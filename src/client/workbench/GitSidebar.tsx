import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GitClient } from '../api.ts'
import type {
  GitBranchInfo, GitFail, GitFileChange, GitLogEntry, GitResult, GitStatusSnapshot,
} from '../../shared/types.ts'
import { GitGraph } from './GitGraph.tsx'
import { GitInitPanel } from './GitInitPanel.tsx'
import { GitScopeBar } from './GitScopeBar.tsx'
import { IconButton } from './IconButton.tsx'
import { isDefaultCommitTemplate, resolveCommitTemplate } from '../../shared/commit-template.ts'
import { visibleSyncActions } from '../../shared/sync-actions.ts'
import {
  DEFAULT_GIT_SYNC_PREFS,
  pullCommandPreview,
  pushCommandPreview,
  readGitSyncPrefs,
  writeGitSyncPrefs,
  type GitSyncPrefs, type PullMode, type PushMode,
} from '../../shared/git-sync-prefs.ts'
import { invalidBranchName } from '../../shared/branch-name.ts'
import { IconAutoRefresh, IconCheck, IconChevron, IconCompact, IconFetch, IconMerge, IconMinus, IconNewBranch, IconPlus, IconPull, IconPush, IconRestore, IconSparkle, IconTune } from './icons.tsx'
import { readNearbyGit, retainNearbyGit, setNearbyRepo, setParentGitDecision, subscribeNearbyGit } from './nearby-git.ts'
import {
  readGitLiveStatus,
  retainGitLive,
  subscribeGitLive,
} from './git-live.ts'
import { parentNeedsAsk } from '../../shared/git-nearby.ts'
import { readDocumentColorScheme } from './surface-scheme.ts'
import type { Translate } from './types.ts'
import { clampGraphHeight, GRAPH_DEFAULT_H, GRAPH_MIN_H, measureReservedAboveGraph } from './graph-layout.ts'
import {
  CHANGES_OPEN_KEY, DEFAULT_CHANGES_OPEN, DEFAULT_GIT_SETTINGS_OPEN, DEFAULT_GRAPH_COMPACT,
  DEFAULT_GRAPH_OPEN, GIT_SETTINGS_OPEN_KEY, GRAPH_COMPACT_KEY, GRAPH_OPEN_KEY,
  readBoolFlag, writeBoolFlag,
} from './ui-flags.ts'
import css from './GitSidebar.module.css'

export interface GitSidebarProps {
  client: GitClient
  workspaceId?: string
  selected?: { path: string; staged: boolean } | null
  onOpenDiff: (path: string, staged: boolean, repo?: string) => void
  onOpenCommitDiff: (hash: string, path: string, repo?: string) => void
  t: Translate
}

const KIND_MARK: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: 'C',
}

const GRAPH_H_KEY = 'dsh-workbench-graph-h'
const TEMPLATE_KEY = 'dsh-workbench-commit-template'
const MESSAGE_MIN_H = 32
const MESSAGE_MAX_H = 140

function readCustomTemplate(): string | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    if (raw === null || raw.trim() === '' || isDefaultCommitTemplate(raw)) return null
    return resolveCommitTemplate(raw)
  } catch {
    return null
  }
}

function writeCustomTemplate(value: string, fallback: string): string | null {
  const next = resolveCommitTemplate(value, fallback)
  try {
    if (isDefaultCommitTemplate(next)) {
      localStorage.removeItem(TEMPLATE_KEY)
      return null
    }
    localStorage.setItem(TEMPLATE_KEY, next)
    return next
  } catch {
    return isDefaultCommitTemplate(next) ? null : next
  }
}

type GraphPrompt = 'branch' | 'merge' | null
type RestoreAsk = { untracked: boolean; paths: string[] } | null

function restoreFilesLabel(paths: string[], t: Translate): string {
  if (paths.length === 1) return paths[0] ?? ''
  const head = paths.slice(0, 5).join('、')
  if (paths.length <= 5) return head
  return t('restore.more', { list: head, count: paths.length })
}

function FileRow({
  file, active, action, actionLabel, restoreLabel, onSelect, onAction, onRestore, disabled, disabledReason,
}: {
  file: GitFileChange
  active: boolean
  action: 'stage' | 'unstage'
  actionLabel: string
  restoreLabel?: string
  onSelect: () => void
  onAction: () => void
  onRestore?: () => void
  disabled: boolean
  disabledReason?: string
}) {
  return (
    <li className={css.file} data-active={active || undefined}>
      <span className={css.fileKind} data-kind={file.kind} title={file.labelZh}>
        {KIND_MARK[file.kind] ?? '?'}
      </span>
      <button type="button" className={css.filePath} title={file.path} onClick={onSelect}>
        {file.path}
      </button>
      {onRestore !== undefined && restoreLabel !== undefined ? (
        <IconButton dense label={disabled ? (disabledReason ?? restoreLabel) : restoreLabel} disabled={disabled} onClick={onRestore}>
          <IconRestore />
        </IconButton>
      ) : null}
      <button type="button" className={css.fileAction} disabled={disabled} onClick={onAction} title={disabled ? (disabledReason ?? actionLabel) : actionLabel}>
        {action === 'stage' ? '+' : '−'}
      </button>
    </li>
  )
}

function FileGroup({
  title, files, selected, staged, action, actionLabel, bulkLabel, restoreLabel, bulkRestoreLabel,
  rowKey, disabled, disabledReason, onOpenDiff, onFileAction, onBulkAction, onRestore, onBulkRestore,
}: {
  title: string
  files: GitFileChange[]
  selected?: { path: string; staged: boolean } | null
  staged: boolean
  action: 'stage' | 'unstage'
  actionLabel: string
  bulkLabel: string
  restoreLabel?: string
  bulkRestoreLabel?: string
  rowKey: string
  disabled: boolean
  disabledReason?: string
  onOpenDiff: (path: string, staged: boolean) => void
  onFileAction: (path: string) => void
  onBulkAction: () => void
  onRestore?: (path: string) => void
  onBulkRestore?: () => void
}) {
  if (files.length === 0) return null
  return (
    <div className={css.group}>
      <div className={css.groupHead}>
        <span className={css.groupTitle}>{title}</span>
        <span className={css.sectionCount}>{files.length}</span>
        <span className={css.sectionGrow} />
        {onBulkRestore !== undefined && bulkRestoreLabel !== undefined ? (
          <IconButton label={disabled ? (disabledReason ?? bulkRestoreLabel) : bulkRestoreLabel} disabled={disabled} onClick={onBulkRestore}>
            <IconRestore />
          </IconButton>
        ) : null}
        <IconButton label={disabled ? (disabledReason ?? bulkLabel) : bulkLabel} disabled={disabled} onClick={onBulkAction}>
          {action === 'stage' ? <IconPlus /> : <IconMinus />}
        </IconButton>
      </div>
      <ul className={css.files} aria-label={title}>
        {files.map(file => (
          <FileRow
            key={`${rowKey}:${file.path}`}
            file={file}
            active={selected?.path === file.path && selected.staged === staged}
            action={action}
            actionLabel={actionLabel}
            restoreLabel={restoreLabel}
            disabled={disabled}
            disabledReason={disabledReason}
            onSelect={() => { onOpenDiff(file.path, staged) }}
            onAction={() => { onFileAction(file.path) }}
            onRestore={onRestore === undefined ? undefined : () => { onRestore(file.path) }}
          />
        ))}
      </ul>
    </div>
  )
}

/** Cursor-like source-control column: CHANGES + resizable GRAPH. */
export function GitSidebar({ client, workspaceId, selected, onOpenDiff, onOpenCommitDiff, t }: GitSidebarProps) {
  const rootRef = useRef<HTMLElement>(null)
  const nearby = useSyncExternalStore(subscribeNearbyGit, readNearbyGit, readNearbyGit)
  const polledStatus = useSyncExternalStore(subscribeGitLive, readGitLiveStatus, () => null)
  const repoId = nearby.selectedId
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<'commit' | 'push' | 'pull' | 'fetch' | null>(null)
  const [remoteSyncing, setRemoteSyncing] = useState(false)
  const [remoteHint, setRemoteHint] = useState<GitFail | null>(null)
  const busyLock = useRef(false)
  const remoteLock = useRef(false)
  const hasRemoteRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const generateAbort = useRef<AbortController | null>(null)
  const [error, setError] = useState<GitFail | null>(null)
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [message, setMessage] = useState('')
  const [customTemplate, setCustomTemplate] = useState<string | null>(readCustomTemplate)
  const [templateOpen, setTemplateOpen] = useState(() => readBoolFlag(GIT_SETTINGS_OPEN_KEY, DEFAULT_GIT_SETTINGS_OPEN))
  const [templateDraft, setTemplateDraft] = useState('')
  const [syncPrefs, setSyncPrefs] = useState<GitSyncPrefs>(readGitSyncPrefs)
  const [prefsDraft, setPrefsDraft] = useState<GitSyncPrefs>(readGitSyncPrefs)
  const localeDefault = t('commit.templateDefault')
  const template = customTemplate ?? localeDefault
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const [changesOpen, setChangesOpen] = useState(() => readBoolFlag(CHANGES_OPEN_KEY, DEFAULT_CHANGES_OPEN))
  const [graphOpen, setGraphOpen] = useState(() => readBoolFlag(GRAPH_OPEN_KEY, DEFAULT_GRAPH_OPEN))
  const [graphCompact, setGraphCompact] = useState(() => readBoolFlag(GRAPH_COMPACT_KEY, DEFAULT_GRAPH_COMPACT))
  const [prompt, setPrompt] = useState<GraphPrompt>(null)
  const [restoreAsk, setRestoreAsk] = useState<RestoreAsk>(null)
  const [promptValue, setPromptValue] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [graphH, setGraphH] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(GRAPH_H_KEY))
      return Number.isFinite(raw) && raw >= GRAPH_MIN_H ? raw : GRAPH_DEFAULT_H
    } catch {
      return GRAPH_DEFAULT_H
    }
  })
  const [hostH, setHostH] = useState(0)
  const [reserved, setReserved] = useState(160)
  const [dragging, setDragging] = useState(false)
  const graphHFit = clampGraphHeight(graphH, hostH, reserved)
  const settingsHydrated = useRef(false)

  useLayoutEffect(() => {
    if (settingsHydrated.current || !templateOpen) return
    settingsHydrated.current = true
    setTemplateDraft(template)
    setPrefsDraft(readGitSyncPrefs())
  }, [templateOpen, template])

  const refresh = async (): Promise<GitStatusSnapshot | null> => {
    if (workspaceId === undefined) {
      setStatus(null)
      setError(null)
      hasRemoteRef.current = false
      return null
    }
    setLoading(true)
    const statusResult = await client.status(workspaceId, repoId)
    if (!statusResult.ok) {
      setLoading(false)
      if (statusResult.code === 'BUSY') return status
      if (statusResult.code === 'UNKNOWN_REPO') {
        setNearbyRepo('.')
        return null
      }
      if (statusResult.code === 'NOT_A_REPO') {
        setError(null)
        const empty = {
          probe: { gitAvailable: true, isRepo: false, detached: false, ahead: 0, behind: 0, hasHead: false },
          staged: [] as GitFileChange[],
          unstaged: [] as GitFileChange[],
          untracked: [] as GitFileChange[],
        }
        setStatus(empty)
        setBranches([])
        setLog([])
        hasRemoteRef.current = false
        return empty
      }
      setStatus(null)
      setError(statusResult)
      hasRemoteRef.current = false
      return null
    }
    if (!statusResult.value.probe.isRepo) {
      setLoading(false)
      setError(null)
      setStatus(statusResult.value)
      setBranches([])
      setLog([])
      hasRemoteRef.current = false
      return statusResult.value
    }
    const [branchResult, logResult] = await Promise.all([
      client.branches(workspaceId, repoId),
      client.log(workspaceId, repoId),
    ])
    setLoading(false)
    setError(null)
    setStatus(statusResult.value)
    hasRemoteRef.current = statusResult.value.probe.remote !== undefined
    setBranches(branchResult.ok ? branchResult.value : [])
    setLog(logResult.ok ? logResult.value : [])
    return statusResult.value
  }

  const checkRemote = async (silent: boolean): Promise<void> => {
    if (workspaceId === undefined || busyLock.current) return
    if (!hasRemoteRef.current) return
    remoteLock.current = true
    setRemoteSyncing(true)
    if (!silent) setPending('fetch')
    try {
      const result = await client.fetch(workspaceId, repoId)
      if (!result.ok) {
        if (result.code === 'BUSY') return
        if (silent) setRemoteHint(result)
        else setError(result)
        return
      }
      setRemoteHint(null)
      if (!busyLock.current) await refresh()
    } finally {
      remoteLock.current = false
      setRemoteSyncing(false)
      if (!silent) setPending(current => current === 'fetch' ? null : current)
    }
  }

  useEffect(() => retainNearbyGit(client, workspaceId), [client, workspaceId])
  useEffect(() => retainGitLive(client, workspaceId, repoId), [client, workspaceId, repoId])

  useEffect(() => {
    if (busyLock.current || polledStatus === null) return
    setStatus(polledStatus)
    hasRemoteRef.current = polledStatus.probe.remote !== undefined
  }, [polledStatus])

  useLayoutEffect(() => {
    const host = rootRef.current
    if (host === null) return
    host.style.colorScheme = readDocumentColorScheme(host)
  }, [nearby.snapshot, repoId, status])

  useEffect(() => {
    let live = true
    setStatus(null)
    setBranches([])
    setLog([])
    setError(null)
    void (async () => {
      await refresh()
    })()
    return () => { live = false }
  }, [workspaceId, repoId])

  useLayoutEffect(() => {
    const area = messageRef.current
    if (area === null) return
    area.style.height = '0px'
    const next = Math.min(MESSAGE_MAX_H, Math.max(MESSAGE_MIN_H, area.scrollHeight))
    area.style.height = `${next}px`
    area.toggleAttribute('data-overflow', next >= MESSAGE_MAX_H)
  }, [message])

  const runWrite = async (
    action: () => Promise<GitResult<unknown>>,
    kind: 'commit' | 'push' | 'pull' | null = null,
  ): Promise<void> => {
    if (workspaceId === undefined || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setPending(kind)
    try {
      const result = await action()
      if (!result.ok) {
        if (result.code !== 'BUSY') setError(result as GitFail)
        return
      }
      setError(null)
      await refresh()
    } finally {
      busyLock.current = false
      setBusy(false)
      setPending(null)
    }
  }

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    // Capture the pointer so pointermove/pointerup keep arriving even when
    // the cursor leaves the window or moves over an iframe (BrowserView);
    // without capture a lost pointerup strands the drag listeners forever.
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* pointer already inactive */ }
    const startY = event.clientY
    const startH = graphHFit
    const host = rootRef.current
    const room = host === null ? reserved : measureReservedAboveGraph(host)
    const column = host?.clientHeight ?? hostH
    let latest = startH
    setDragging(true)
    const move = (next: PointerEvent): void => {
      const liveH = host?.clientHeight ?? column
      const liveRoom = host === null ? room : measureReservedAboveGraph(host)
      latest = clampGraphHeight(startH + (startY - next.clientY), liveH, liveRoom)
      setGraphH(latest)
    }
    const end = (): void => {
      try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
      setDragging(false)
      try { localStorage.setItem(GRAPH_H_KEY, String(latest)) } catch { /* ignore */ }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const stagedCount = status?.staged.length ?? 0
  const unstagedCount = status?.unstaged.length ?? 0
  const untrackedCount = status?.untracked.length ?? 0
  const dirtyCount = stagedCount + unstagedCount + untrackedCount
  const stageAllPaths = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])].map(file => file.path)
  const branchName = status?.probe.detached ? t('panel.detached') : (status?.probe.branch ?? t('panel.title'))
  const commitAll = stagedCount === 0 && dirtyCount > 0
  const busyBlockReason = busy ? t('action.disabledBusy') : null
  const remoteBlockReason = remoteSyncing ? t('panel.checkingRemote') : null
  const commitDisabledReason = generating
    ? t('commit.generating')
    : message.trim() === ''
      ? t('commit.disabledEmpty')
      : dirtyCount === 0
        ? t('commit.disabledNothing')
        : busyBlockReason
  const probe = status?.probe
  const actions = visibleSyncActions({
    dirtyCount,
    detached: probe?.detached === true,
    ahead: probe?.ahead ?? 0,
    behind: probe?.behind ?? 0,
    hasRemote: probe?.remote !== undefined,
    hasUpstream: probe?.upstream !== undefined,
    hasHead: probe?.hasHead === true,
  })
  const remoteLabel = probe?.upstream ?? (probe?.remote !== undefined ? `${probe.remote}/${branchName}` : branchName)
  const behindCount = probe?.behind ?? 0
  const aheadCount = probe?.ahead ?? 0
  const pushDisabledReason = remoteBlockReason ?? busyBlockReason
    ?? (probe?.detached === true
      ? t('push.disabledDetached')
      : probe?.remote === undefined
        ? t('push.disabledNoRemote')
        : behindCount > 0 && syncPrefs.pushMode !== 'lease'
          ? t('push.disabledBehind', { count: behindCount })
          : aheadCount === 0 && probe?.upstream !== undefined
            ? t('push.disabledNothing')
            : !probe?.hasHead
              ? t('push.disabledNothing')
              : null)
  const pullDisabledReason = remoteBlockReason ?? busyBlockReason
    ?? (probe?.detached === true
      ? t('pull.disabledDetached')
      : probe?.remote === undefined
        ? t('pull.disabledNoRemote')
        : probe?.upstream === undefined
          ? t('pull.disabledNoUpstream')
          : dirtyCount > 0 && behindCount > 0
            ? t('pull.disabledDirtyBehind', { count: behindCount })
            : dirtyCount > 0
              ? t('pull.disabledDirty')
              : behindCount === 0
                ? t('pull.disabledNothing')
                : null)
  const fetchDisabledReason = remoteBlockReason ?? busyBlockReason
    ?? (probe?.remote === undefined
      ? t('fetch.disabledNoRemote')
      : null)
  const refreshDisabledReason = loading || busy
    ? t('action.disabledBusy')
    : null
  const mergeTargets = branches.filter(branch => !branch.current && branch.name !== probe?.branch)
  const mergeDisabledReason = busyBlockReason
    ?? (probe?.detached === true
      ? t('merge.disabledDetached')
      : dirtyCount > 0
        ? t('merge.disabledDirty')
        : mergeTargets.length === 0
          ? t('merge.disabledNone')
          : null)
  const writesDisabled = busyBlockReason !== null || status === null || !status.probe.gitAvailable || !status.probe.isRepo
  const generateDisabled = writesDisabled || dirtyCount === 0
  const graphFills = changesOpen === false && graphOpen
  const showSyncPulse = busy || remoteSyncing || pending !== null || loading

  useLayoutEffect(() => {
    const host = rootRef.current
    if (host === null) return
    const apply = (): void => {
      const nextReserved = measureReservedAboveGraph(host)
      const nextH = host.clientHeight
      setReserved(prev => prev === nextReserved ? prev : nextReserved)
      setHostH(prev => prev === nextH ? prev : nextH)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [changesOpen, graphOpen, error, loading, workspaceId, dirtyCount, actions.commit, actions.push, actions.pull])

  const toggleChanges = (): void => {
    setChangesOpen((open) => {
      writeBoolFlag(CHANGES_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleGraph = (): void => {
    setGraphOpen((open) => {
      writeBoolFlag(GRAPH_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleCompact = (): void => {
    setGraphCompact((on) => {
      writeBoolFlag(GRAPH_COMPACT_KEY, !on)
      return !on
    })
  }
  const closePrompt = (): void => {
    setPrompt(null)
    setPromptValue('')
    setPromptError(null)
  }
  const openPrompt = (kind: Exclude<GraphPrompt, null>): void => {
    if (writesDisabled) return
    writeBoolFlag(GIT_SETTINGS_OPEN_KEY, false)
    setTemplateOpen(false)
    setPrompt(kind)
    setPromptValue('')
    setPromptError(null)
  }

  const commit = (): void => {
    if (workspaceId === undefined || commitDisabledReason !== null) return
    void runWrite(async () => {
      const result = await client.commit(workspaceId, message, commitAll, repoId)
      if (result.ok) setMessage('')
      return result
    }, 'commit')
  }

  const push = (): void => {
    if (workspaceId === undefined || pushDisabledReason !== null) return
    void runWrite(() => client.push(workspaceId, syncPrefs.pushMode, repoId), 'push')
  }

  const pull = (): void => {
    if (workspaceId === undefined || pullDisabledReason !== null) return
    void runWrite(() => client.pull(workspaceId, syncPrefs.pullMode, repoId), 'pull')
  }

  const fetchRemote = (): void => {
    if (workspaceId === undefined || fetchDisabledReason !== null) return
    void checkRemote(false)
  }

  const refreshLocal = (): void => {
    if (refreshDisabledReason !== null) return
    void refresh()
  }

  const runPromptWrite = async (
    action: () => Promise<GitResult<unknown>>,
    keepCodes: readonly string[],
  ): Promise<void> => {
    if (busy || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    try {
      const result = await action()
      if (!result.ok) {
        if (keepCodes.includes(result.code)) {
          setPromptError(result.messageZh)
          return
        }
        closePrompt()
        setError(result)
        return
      }
      setError(null)
      closePrompt()
      await refresh()
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }

  const submitPrompt = (): void => {
    if (workspaceId === undefined || writesDisabled) return
    if (prompt === 'branch') {
      const reason = invalidBranchName(promptValue)
      if (reason === 'empty') {
        setPromptError(t('branch.newEmpty'))
        return
      }
      if (reason === 'invalid') {
        setPromptError(t('branch.newInvalid'))
        return
      }
      void runPromptWrite(
        () => client.createBranch(workspaceId, promptValue, repoId),
        ['BRANCH_EXISTS', 'BRANCH_INVALID'],
      )
      return
    }
    if (prompt === 'merge') {
      if (promptValue.trim() === '') {
        setPromptError(t('merge.disabledEmpty'))
        return
      }
      void runPromptWrite(
        () => client.mergeBranch(workspaceId, promptValue, repoId),
        ['BRANCH_MISSING', 'BRANCH_INVALID'],
      )
    }
  }

  const generate = (): void => {
    if (workspaceId === undefined || generateDisabled || generating) return
    generateAbort.current?.abort()
    const controller = new AbortController()
    generateAbort.current = controller
    setGenerating(true)
    setError(null)
    void client.generateCommitMessage(workspaceId, template, {
      signal: controller.signal,
      repo: repoId,
      onDelta: (text) => {
        if (controller.signal.aborted) return
        setMessage(text)
      },
    }).then((result) => {
      if (controller.signal.aborted) {
        setGenerating(false)
        return
      }
      setGenerating(false)
      if (generateAbort.current === controller) generateAbort.current = null
      if (!result.ok) {
        setError(result)
        return
      }
      setError(null)
      setMessage(result.value.message.trim())
    })
  }

  const openTemplate = (): void => {
    setPrompt(null)
    setTemplateDraft(template)
    setPrefsDraft(readGitSyncPrefs())
    writeBoolFlag(GIT_SETTINGS_OPEN_KEY, true)
    setTemplateOpen(true)
  }

  const closeTemplate = (): void => {
    writeBoolFlag(GIT_SETTINGS_OPEN_KEY, false)
    setTemplateOpen(false)
  }

  const closeRestore = (): void => {
    setRestoreAsk(null)
  }

  const confirmRestore = (): void => {
    if (restoreAsk === null || workspaceId === undefined) return
    const paths = restoreAsk.paths
    setRestoreAsk(null)
    void runWrite(() => client.restore(workspaceId, paths, repoId))
  }

  const saveTemplate = (): void => {
    setCustomTemplate(writeCustomTemplate(templateDraft, localeDefault))
    setSyncPrefs(writeGitSyncPrefs(prefsDraft))
    writeBoolFlag(GIT_SETTINGS_OPEN_KEY, false)
    setTemplateOpen(false)
  }

  const openFileDiff = (path: string, staged: boolean): void => {
    onOpenDiff(path, staged, repoId)
  }
  const askParent = parentNeedsAsk(nearby.snapshot, nearby.parentDecision)
  const skippedParent = nearby.snapshot?.parent !== null && nearby.snapshot?.parent !== undefined && nearby.parentDecision === 'skip'
    ? nearby.snapshot.parent
    : null
  const branchLabel = status !== null && !status.probe.isRepo
    ? t('init.header')
    : branchName

  return (
    <aside
      ref={rootRef}
      className={css.root}
      aria-label={t('panel.title')}
      style={{ '--git-graph-h': `${graphHFit}px`, '--git-graph-reserved': `${reserved}px` } as never}
    >
      <header className={css.head} data-git-chrome="head">
        <GitScopeBar
          nearby={nearby}
          branches={branches}
          branchLabel={branchLabel}
          currentBranch={status?.probe.branch}
          detached={status?.probe.detached === true}
          disabled={writesDisabled}
          onSelectRepo={setNearbyRepo}
          onSwitchBranch={(name) => {
            if (workspaceId === undefined || name === status?.probe.branch) return
            void runWrite(() => client.switchBranch(workspaceId, name, repoId))
          }}
          t={t}
        />
        {status !== null && status.probe.ahead > 0 ? <span className={css.chip} data-kind="ahead">{t('panel.ahead', { count: status.probe.ahead })}</span> : null}
        {status !== null && status.probe.behind > 0 ? <span className={css.chip} data-kind="behind">{t('panel.behind', { count: status.probe.behind })}</span> : null}
        <IconButton
          label={refreshDisabledReason ?? t('panel.refresh')}
          disabled={refreshDisabledReason !== null}
          active={loading}
          onClick={refreshLocal}
        >
          <IconAutoRefresh />
        </IconButton>
      </header>
      {skippedParent !== null ? (
        <div className={css.parentHint} data-git-chrome="parent-hint">
          <span>{t('repo.parentHint', { name: skippedParent.name })}</span>
          <button type="button" className={css.parentHintBtn} onClick={() => { setParentGitDecision('include') }}>
            {t('repo.parentHintYes')}
          </button>
        </div>
      ) : null}

      {workspaceId === undefined ? <p className={css.hint} data-git-chrome="hint" style={{ padding: '8px 10px' }}>{t('panel.noWorkspace')}</p> : null}
      {error !== null && error.code !== 'NOT_A_REPO' ? (
        <div className={css.banner} data-git-chrome="banner">
          <div>{error.messageZh}</div>
          <div className={css.bannerHint}>{error.hintZh}</div>
        </div>
      ) : remoteHint !== null ? (
        <div className={css.banner} data-kind="warn" data-git-chrome="banner">
          <div>{t('remote.checkFail')}</div>
          <div className={css.bannerHint}>{remoteHint.messageZh}</div>
        </div>
      ) : null}
      {loading && status === null ? <p className={css.hint} data-git-chrome="hint" style={{ padding: '8px 10px' }}>{t('panel.loading')}</p> : null}

      {workspaceId !== undefined && status !== null && status.probe.gitAvailable && !status.probe.isRepo ? (
        <GitInitPanel
          client={client}
          workspaceId={workspaceId}
          t={t}
          onReady={async () => { await refresh() }}
        />
      ) : null}

      {status !== null && status.probe.isRepo ? (
        <>
          <div className={css.commitArea} data-git-chrome="commit">
            <div className={css.commitBox}>
              <textarea
                ref={messageRef}
                className={css.textarea}
                rows={1}
                value={message}
                placeholder={generating && message === '' ? t('commit.generating') : t('commit.placeholder', { branch: branchName })}
                disabled={writesDisabled}
                readOnly={generating}
                onChange={(event) => { setMessage(event.target.value) }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  }
                }}
              />
              <span className={css.generate} data-spinning={generating || undefined}>
                <IconButton
                  dense
                  label={generateDisabled ? t('commit.generateDisabled') : generating ? t('commit.generating') : t('commit.generate')}
                  disabled={generateDisabled}
                  onClick={generate}
                >
                  {generating ? <span className={css.spinner} aria-hidden /> : <IconSparkle />}
                </IconButton>
              </span>
            </div>
            {actions.commit || actions.push || actions.pull ? (
              <div className={css.actionRow} role="group" aria-label={t('section.commit')}>
                {actions.commit ? (
                  <button
                    type="button"
                    className={css.actionBtn}
                    data-pending={pending === 'commit' || undefined}
                    aria-busy={pending === 'commit' || undefined}
                    disabled={commitDisabledReason !== null || writesDisabled}
                    title={pending === 'commit'
                      ? (commitAll ? t('action.committingAll') : t('action.committingOn', { branch: branchName }))
                      : (commitDisabledReason ?? undefined)}
                    onClick={commit}
                  >
                    {pending === 'commit' ? <span className={css.spinner} aria-hidden /> : <IconCheck />}
                    <span className={css.commitLabel}>
                      {pending === 'commit'
                        ? (commitAll ? t('action.committingAll') : t('action.committingOn', { branch: branchName }))
                        : (commitAll ? t('action.commitAll') : t('action.commitOn', { branch: branchName }))}
                    </span>
                  </button>
                ) : null}
                {actions.push ? (
                  <button
                    type="button"
                    className={css.actionBtn}
                    data-pending={pending === 'push' || undefined}
                    aria-busy={pending === 'push' || undefined}
                    disabled={pushDisabledReason !== null || writesDisabled}
                    title={pending === 'push'
                      ? t('action.pushingOn', { remote: remoteLabel })
                      : (pushDisabledReason ?? undefined)}
                    onClick={push}
                  >
                    {pending === 'push' ? <span className={css.spinner} aria-hidden /> : <IconPush />}
                    <span className={css.commitLabel}>
                      {pending === 'push' ? t('action.pushingOn', { remote: remoteLabel }) : t('action.pushOn', { remote: remoteLabel })}
                    </span>
                  </button>
                ) : null}
                {actions.pull ? (
                  <button
                    type="button"
                    className={css.actionBtn}
                    data-pending={pending === 'pull' || undefined}
                    aria-busy={pending === 'pull' || undefined}
                    disabled={pullDisabledReason !== null || writesDisabled}
                    title={pending === 'pull'
                      ? t('action.pullingOn', { remote: remoteLabel })
                      : (pullDisabledReason ?? undefined)}
                    onClick={pull}
                  >
                    {pending === 'pull' ? <span className={css.spinner} aria-hidden /> : <IconPull />}
                    <span className={css.commitLabel}>
                      {pending === 'pull' ? t('action.pullingOn', { remote: remoteLabel }) : t('action.pullOn', { remote: remoteLabel })}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : probe?.remote !== undefined && !probe.detached && dirtyCount === 0 ? (
              <p className={css.hint}>{t('sync.clean')}</p>
            ) : null}
          </div>
          <div
            className={css.remotePulse}
            data-active={showSyncPulse || undefined}
            data-git-chrome="remote-pulse"
            role={showSyncPulse ? 'progressbar' : undefined}
            aria-hidden={showSyncPulse ? undefined : true}
            aria-label={showSyncPulse ? t('panel.syncing') : undefined}
          />

          <section
            className={css.pane}
            data-kind="changes"
            data-open={changesOpen || undefined}
            data-syncing={showSyncPulse || undefined}
            aria-busy={showSyncPulse || undefined}
          >
            <div className={css.sectionHead} data-git-chrome="changes-head">
              <button type="button" className={css.sectionToggle} aria-expanded={changesOpen} onClick={toggleChanges}>
                <IconChevron open={changesOpen} />
                <span className={css.sectionTitle}>{t('section.changes')}</span>
                {dirtyCount > 0 ? <span className={css.sectionCount}>{dirtyCount}</span> : null}
              </button>
              <div className={css.sectionActions}>
                <IconButton
                  dense
                  label={t('gitSettings.open')}
                  active={customTemplate !== null || syncPrefs.pullMode !== 'merge' || syncPrefs.pushMode !== 'safe'}
                  onClick={openTemplate}
                >
                  <IconTune />
                </IconButton>
                {stageAllPaths.length > 0 ? (
                  <IconButton
                    dense
                    label={busyBlockReason ?? t('action.stageAll')}
                    disabled={writesDisabled}
                    onClick={() => {
                      if (workspaceId) void runWrite(() => client.stage(workspaceId, stageAllPaths, repoId))
                    }}
                  >
                    <IconPlus />
                  </IconButton>
                ) : null}
              </div>
            </div>
            {changesOpen ? (
              <div className={css.paneBody}>
                {dirtyCount === 0 ? <p className={css.hint}>{t('panel.empty')}</p> : null}
                <FileGroup
                  title={t('section.staged')}
                  files={status.staged}
                  selected={selected}
                  staged
                  action="unstage"
                  actionLabel={t('action.unstage')}
                  bulkLabel={t('action.unstageAllStaged')}
                  rowKey="s"
                  disabled={writesDisabled}
                  disabledReason={busyBlockReason ?? undefined}
                  onOpenDiff={openFileDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.unstage(workspaceId, [path], repoId)) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.unstage(workspaceId, status.staged.map(file => file.path), repoId))
                  }}
                />
                <FileGroup
                  title={t('section.unstaged')}
                  files={status.unstaged}
                  selected={selected}
                  staged={false}
                  action="stage"
                  actionLabel={t('action.stage')}
                  bulkLabel={t('action.stageAllUnstaged')}
                  restoreLabel={t('action.restore')}
                  bulkRestoreLabel={t('action.restoreAll')}
                  rowKey="u"
                  disabled={writesDisabled}
                  disabledReason={busyBlockReason ?? undefined}
                  onOpenDiff={openFileDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [path], repoId)) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.stage(workspaceId, status.unstaged.map(file => file.path), repoId))
                  }}
                  onRestore={(path) => { setRestoreAsk({ untracked: false, paths: [path] }) }}
                  onBulkRestore={() => {
                    setRestoreAsk({ untracked: false, paths: status.unstaged.map(file => file.path) })
                  }}
                />
                <FileGroup
                  title={t('section.untracked')}
                  files={status.untracked}
                  selected={selected}
                  staged={false}
                  action="stage"
                  actionLabel={t('action.stage')}
                  bulkLabel={t('action.stageAllUntracked')}
                  restoreLabel={t('action.restoreUntracked')}
                  bulkRestoreLabel={t('action.restoreAllUntracked')}
                  rowKey="n"
                  disabled={writesDisabled}
                  disabledReason={busyBlockReason ?? undefined}
                  onOpenDiff={openFileDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [path], repoId)) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.stage(workspaceId, status.untracked.map(file => file.path), repoId))
                  }}
                  onRestore={(path) => { setRestoreAsk({ untracked: true, paths: [path] }) }}
                  onBulkRestore={() => {
                    setRestoreAsk({ untracked: true, paths: status.untracked.map(file => file.path) })
                  }}
                />
              </div>
            ) : null}
          </section>

          {changesOpen && graphOpen ? (
            <button
              type="button"
              className={css.gutter}
              data-active={dragging || undefined}
              aria-label={t('section.resize')}
              onPointerDown={beginResize}
            />
          ) : null}

          <section className={css.pane} data-kind="graph" data-open={graphOpen || undefined} data-fill={graphFills || undefined}>
            <div className={css.sectionHead}>
              <button type="button" className={css.sectionToggle} aria-expanded={graphOpen} onClick={toggleGraph}>
                <IconChevron open={graphOpen} />
                <span className={css.sectionTitle}>{t('section.graph')}</span>
                {log.length > 0 ? <span className={css.sectionCount}>{log.length}</span> : null}
              </button>
              <div className={css.sectionActions}>
                <IconButton
                  dense
                  label={graphCompact ? t('graph.compactOff') : t('graph.compactOn')}
                  active={graphCompact}
                  aria-pressed={graphCompact}
                  onClick={toggleCompact}
                >
                  <IconCompact />
                </IconButton>
                <IconButton
                  dense
                  label={fetchDisabledReason ?? t('action.fetchOn', { remote: remoteLabel })}
                  disabled={writesDisabled || fetchDisabledReason !== null}
                  onClick={fetchRemote}
                >
                  {pending === 'fetch' ? <span className={css.spinner} aria-hidden /> : <IconFetch />}
                </IconButton>
                <IconButton
                  dense
                  label={pullDisabledReason ?? t('action.pullOn', { remote: remoteLabel })}
                  disabled={writesDisabled || pullDisabledReason !== null}
                  onClick={pull}
                >
                  <IconPull />
                </IconButton>
                <IconButton
                  dense
                  label={pushDisabledReason ?? t('action.pushOn', { remote: remoteLabel })}
                  disabled={writesDisabled || pushDisabledReason !== null}
                  onClick={push}
                >
                  <IconPush />
                </IconButton>
                <IconButton
                  dense
                  label={busyBlockReason ?? t('action.newBranch')}
                  disabled={writesDisabled}
                  onClick={() => { openPrompt('branch') }}
                >
                  <IconNewBranch />
                </IconButton>
                <IconButton
                  dense
                  label={mergeDisabledReason ?? t('action.merge')}
                  disabled={writesDisabled || mergeDisabledReason !== null}
                  onClick={() => { openPrompt('merge') }}
                >
                  <IconMerge />
                </IconButton>
              </div>
            </div>
            {graphOpen ? (
              <div className={css.paneBody}>
                <GitGraph entries={log} emptyLabel={t('graph.empty')} compact={graphCompact} client={client} workspaceId={workspaceId} repo={repoId} onOpenCommitDiff={(hash, path) => { onOpenCommitDiff(hash, path, repoId) }} t={t} />
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {askParent && nearby.snapshot?.parent !== null && nearby.snapshot?.parent !== undefined ? (
        <div
          className={css.dialogMask}
          onClick={() => { setParentGitDecision('skip') }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setParentGitDecision('skip')
          }}
        >
          <div
            className={css.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="git-parent-ask-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="git-parent-ask-title">{t('repo.parentAskTitle')}</h2>
            <p>{t('repo.parentAskBody', { name: nearby.snapshot.parent.name })}</p>
            <div className={css.dialogRow}>
              <button type="button" className={css.dialogCancel} onClick={() => { setParentGitDecision('skip') }}>
                {t('repo.parentAskNo')}
              </button>
              <button type="button" className={css.dialogOk} onClick={() => { setParentGitDecision('include') }}>
                {t('repo.parentAskYes')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {restoreAsk !== null ? (
        <div
          className={css.dialogMask}
          onClick={closeRestore}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeRestore()
          }}
        >
          <div
            className={css.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="git-restore-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="git-restore-title">
              {restoreAsk.untracked ? t('restore.untrackedTitle') : t('restore.title')}
            </h2>
            <p>
              {restoreAsk.untracked
                ? t('restore.untrackedBody', { files: restoreFilesLabel(restoreAsk.paths, t) })
                : t('restore.body', { files: restoreFilesLabel(restoreAsk.paths, t) })}
            </p>
            <div className={css.dialogRow}>
              <button type="button" className={css.dialogCancel} disabled={busy} onClick={closeRestore}>
                {t('restore.cancel')}
              </button>
              <button
                type="button"
                className={`${css.dialogOk} ${css.dialogDanger}`}
                disabled={busy || remoteSyncing}
                onClick={confirmRestore}
              >
                {restoreAsk.untracked ? t('restore.delete') : t('restore.ok')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {templateOpen ? (
        <div
          className={css.dialogMask}
          onClick={closeTemplate}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeTemplate()
          }}
        >
          <div
            className={`${css.dialog} ${css.dialogWide}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-commit-template-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="git-commit-template-title">{t('gitSettings.title')}</h2>
            <div className={css.dialogBody}>
              <p>{t('gitSettings.hint')}</p>
              <fieldset className={css.choiceSet}>
                <legend>{t('gitSettings.pullTitle')}</legend>
                <p className={css.choiceLead}>{t('gitSettings.pullHint')}</p>
                {(['merge', 'ff-only', 'rebase'] as const).map((mode: PullMode) => (
                  <label key={mode} className={css.choice} data-active={prefsDraft.pullMode === mode || undefined}>
                    <input
                      type="radio"
                      name="dsw-pull-mode"
                      checked={prefsDraft.pullMode === mode}
                      onChange={() => { setPrefsDraft(current => ({ ...current, pullMode: mode })) }}
                    />
                    <span>
                      <strong>{t(`gitSettings.pull.${mode}`)}</strong>
                      <code>{pullCommandPreview(mode)}</code>
                      <em>{t(`gitSettings.pull.${mode}Help`)}</em>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className={css.choiceSet}>
                <legend>{t('gitSettings.pushTitle')}</legend>
                <p className={css.choiceLead}>{t('gitSettings.pushHint')}</p>
                {(['safe', 'lease'] as const).map((mode: PushMode) => (
                  <label key={mode} className={css.choice} data-active={prefsDraft.pushMode === mode || undefined}>
                    <input
                      type="radio"
                      name="dsw-push-mode"
                      checked={prefsDraft.pushMode === mode}
                      onChange={() => { setPrefsDraft(current => ({ ...current, pushMode: mode })) }}
                    />
                    <span>
                      <strong>{t(`gitSettings.push.${mode}`)}</strong>
                      <code>{pushCommandPreview(mode)}</code>
                      <em>{t(`gitSettings.push.${mode}Help`)}</em>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className={css.field}>
                <span>{t('commit.templateTitle')}</span>
                <textarea
                  className={css.templateInput}
                  value={templateDraft === '' ? template : templateDraft}
                  onChange={(event) => { setTemplateDraft(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeTemplate()
                  }}
                />
              </label>
            </div>
            <div className={css.dialogRow}>
              <button
                type="button"
                className={css.dialogCancel}
                onClick={() => {
                  setTemplateDraft(localeDefault)
                  setPrefsDraft({ ...DEFAULT_GIT_SYNC_PREFS })
                }}
              >
                {t('commit.templateReset')}
              </button>
              <span className={css.sectionGrow} />
              <button type="button" className={css.dialogCancel} onClick={closeTemplate}>
                {t('commit.templateCancel')}
              </button>
              <button type="button" className={css.dialogOk} onClick={saveTemplate}>
                {t('commit.templateSave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {prompt !== null ? (
        <div
          className={css.dialogMask}
          onClick={closePrompt}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closePrompt()
          }}
        >
          <div
            className={css.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-graph-prompt-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="git-graph-prompt-title">{prompt === 'branch' ? t('branch.newTitle') : t('merge.title')}</h2>
            <p>{prompt === 'branch' ? t('branch.newHint') : t('merge.hint', { branch: branchName })}</p>
            {prompt === 'branch' ? (
              <label className={css.field}>
                <span>{t('action.newBranch')}</span>
                <input
                  className={css.fieldInput}
                  value={promptValue}
                  placeholder={t('branch.newPlaceholder')}
                  autoFocus
                  disabled={busy}
                  onChange={(event) => { setPromptValue(event.target.value); setPromptError(null) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitPrompt()
                    }
                    if (event.key === 'Escape') closePrompt()
                  }}
                />
              </label>
            ) : (
              <label className={css.field}>
                <span>{t('merge.pick')}</span>
                <select
                  className={css.fieldInput}
                  value={promptValue}
                  autoFocus
                  disabled={busy}
                  onChange={(event) => { setPromptValue(event.target.value); setPromptError(null) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitPrompt()
                    }
                    if (event.key === 'Escape') closePrompt()
                  }}
                >
                  <option value="">{t('merge.pickPlaceholder')}</option>
                  {mergeTargets.map(branch => (
                    <option key={branch.name} value={branch.name}>{branch.name}</option>
                  ))}
                </select>
              </label>
            )}
            {promptError !== null ? <p className={css.fieldError}>{promptError}</p> : null}
            <div className={css.dialogRow}>
              <button type="button" className={css.dialogCancel} disabled={busy} onClick={closePrompt}>
                {prompt === 'branch' ? t('branch.newCancel') : t('merge.cancel')}
              </button>
              <button
                type="button"
                className={css.dialogOk}
                disabled={busy || remoteSyncing || (prompt === 'merge' && promptValue.trim() === '')}
                onClick={submitPrompt}
              >
                {prompt === 'branch' ? t('branch.newConfirm') : t('merge.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}