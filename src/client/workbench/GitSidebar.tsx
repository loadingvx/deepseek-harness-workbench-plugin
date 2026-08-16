import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type {
  GitBranchInfo, GitFail, GitFileChange, GitLogEntry, GitResult, GitStatusSnapshot,
} from '../../shared/types.ts'
import { GitGraph } from './GitGraph.tsx'
import { IconButton } from './IconButton.tsx'
import { isDefaultCommitTemplate, resolveCommitTemplate } from '../../shared/commit-template.ts'
import { visibleSyncActions } from '../../shared/sync-actions.ts'
import { invalidBranchName } from '../../shared/branch-name.ts'
import { IconBranch, IconCheck, IconChevron, IconCompact, IconFetch, IconMerge, IconMinus, IconNewBranch, IconPlus, IconPull, IconPush, IconRefresh, IconRestore, IconSparkle, IconTune } from './icons.tsx'
import type { Translate } from './types.ts'
import { clampGraphHeight, GRAPH_DEFAULT_H, GRAPH_MIN_H, measureReservedAboveGraph } from './graph-layout.ts'
import css from './GitSidebar.module.css'

export interface GitSidebarProps {
  client: GitClient
  workspaceId?: string
  selected?: { path: string; staged: boolean } | null
  onOpenDiff: (path: string, staged: boolean) => void
  onOpenCommitDiff: (hash: string, path: string) => void
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
const CHANGES_OPEN_KEY = 'dsh-workbench-changes-open'
const GRAPH_OPEN_KEY = 'dsh-workbench-graph-open'
const GRAPH_COMPACT_KEY = 'dsh-workbench-graph-compact'
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

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch { /* ignore */ }
  return fallback
}

function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* ignore */ }
}

function FileRow({
  file, active, action, actionLabel, restoreLabel, onSelect, onAction, onRestore, disabled,
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
        <IconButton dense label={restoreLabel} disabled={disabled} onClick={onRestore}>
          <IconRestore />
        </IconButton>
      ) : null}
      <button type="button" className={css.fileAction} disabled={disabled} onClick={onAction} title={actionLabel}>
        {action === 'stage' ? '+' : '−'}
      </button>
    </li>
  )
}

function FileGroup({
  title, files, selected, staged, action, actionLabel, bulkLabel, restoreLabel, bulkRestoreLabel,
  rowKey, disabled, onOpenDiff, onFileAction, onBulkAction, onRestore, onBulkRestore,
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
          <IconButton label={bulkRestoreLabel} disabled={disabled} onClick={onBulkRestore}>
            <IconRestore />
          </IconButton>
        ) : null}
        <IconButton label={bulkLabel} disabled={disabled} onClick={onBulkAction}>
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
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<'commit' | 'push' | 'pull' | null>(null)
  const busyLock = useRef(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const generateAbort = useRef<AbortController | null>(null)
  const [error, setError] = useState<GitFail | null>(null)
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [message, setMessage] = useState('')
  const [customTemplate, setCustomTemplate] = useState<string | null>(readCustomTemplate)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState('')
  const localeDefault = t('commit.templateDefault')
  const template = customTemplate ?? localeDefault
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const [changesOpen, setChangesOpen] = useState(() => readFlag(CHANGES_OPEN_KEY, true))
  const [graphOpen, setGraphOpen] = useState(() => readFlag(GRAPH_OPEN_KEY, true))
  const [graphCompact, setGraphCompact] = useState(() => readFlag(GRAPH_COMPACT_KEY, false))
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

  const refresh = async (): Promise<void> => {
    if (workspaceId === undefined) {
      setStatus(null)
      setError(null)
      return
    }
    setLoading(true)
    const [statusResult, branchResult, logResult] = await Promise.all([
      client.status(workspaceId),
      client.branches(workspaceId),
      client.log(workspaceId),
    ])
    setLoading(false)
    if (!statusResult.ok) {
      setStatus(null)
      setError(statusResult)
      return
    }
    setError(null)
    setStatus(statusResult.value)
    setBranches(branchResult.ok ? branchResult.value : [])
    setLog(logResult.ok ? logResult.value : [])
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 8000)
    return () => {
      window.clearInterval(timer)
      generateAbort.current?.abort()
      generateAbort.current = null
    }
  }, [workspaceId])

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
    if (busy || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setPending(kind)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result as GitFail)
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
    const up = (): void => {
      setDragging(false)
      try { localStorage.setItem(GRAPH_H_KEY, String(latest)) } catch { /* ignore */ }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const stagedCount = status?.staged.length ?? 0
  const unstagedCount = status?.unstaged.length ?? 0
  const untrackedCount = status?.untracked.length ?? 0
  const dirtyCount = stagedCount + unstagedCount + untrackedCount
  const stageAllPaths = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])].map(file => file.path)
  const branchName = status?.probe.detached ? t('panel.detached') : (status?.probe.branch ?? t('panel.title'))
  const commitAll = stagedCount === 0 && dirtyCount > 0
  const commitDisabledReason = generating
    ? t('commit.generating')
    : message.trim() === ''
      ? t('commit.disabledEmpty')
      : dirtyCount === 0
        ? t('commit.disabledNothing')
        : busy
          ? t('action.disabledBusy')
          : null
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
  const pushDisabledReason = busy
    ? t('action.disabledBusy')
    : probe?.detached === true
      ? t('push.disabledDetached')
      : probe?.remote === undefined
        ? t('push.disabledNoRemote')
        : (probe?.behind ?? 0) > 0
          ? t('push.disabledBehind')
          : (probe?.ahead ?? 0) === 0 && probe?.upstream !== undefined
            ? t('push.disabledNothing')
            : !probe?.hasHead
              ? t('push.disabledNothing')
              : null
  const pullDisabledReason = busy
    ? t('action.disabledBusy')
    : probe?.detached === true
      ? t('pull.disabledDetached')
      : probe?.remote === undefined
        ? t('pull.disabledNoRemote')
        : probe?.upstream === undefined
          ? t('pull.disabledNoUpstream')
          : dirtyCount > 0
            ? t('pull.disabledDirty')
            : (probe?.behind ?? 0) === 0
              ? t('pull.disabledNothing')
              : null
  const fetchDisabledReason = busy
    ? t('action.disabledBusy')
    : probe?.remote === undefined
      ? t('fetch.disabledNoRemote')
      : null
  const mergeTargets = branches.filter(branch => !branch.current && branch.name !== probe?.branch)
  const mergeDisabledReason = busy
    ? t('action.disabledBusy')
    : probe?.detached === true
      ? t('merge.disabledDetached')
      : dirtyCount > 0
        ? t('merge.disabledDirty')
        : mergeTargets.length === 0
          ? t('merge.disabledNone')
          : null
  const writesDisabled = busy || status === null || !status.probe.gitAvailable || !status.probe.isRepo
  const generateDisabled = writesDisabled || dirtyCount === 0
  const graphFills = changesOpen === false && graphOpen

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
      writeFlag(CHANGES_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleGraph = (): void => {
    setGraphOpen((open) => {
      writeFlag(GRAPH_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleCompact = (): void => {
    setGraphCompact((on) => {
      writeFlag(GRAPH_COMPACT_KEY, !on)
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
    setTemplateOpen(false)
    setPrompt(kind)
    setPromptValue('')
    setPromptError(null)
  }

  const commit = (): void => {
    if (workspaceId === undefined || commitDisabledReason !== null) return
    void runWrite(async () => {
      const result = await client.commit(workspaceId, message, commitAll)
      if (result.ok) setMessage('')
      return result
    }, 'commit')
  }

  const push = (): void => {
    if (workspaceId === undefined || pushDisabledReason !== null) return
    void runWrite(() => client.push(workspaceId), 'push')
  }

  const pull = (): void => {
    if (workspaceId === undefined || pullDisabledReason !== null) return
    void runWrite(() => client.pull(workspaceId), 'pull')
  }

  const fetchRemote = (): void => {
    if (workspaceId === undefined || fetchDisabledReason !== null) return
    void runWrite(() => client.fetch(workspaceId))
  }

  const runPromptWrite = async (
    action: () => Promise<GitResult<unknown>>,
    keepCodes: readonly string[],
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    const result = await action()
    setBusy(false)
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
        () => client.createBranch(workspaceId, promptValue),
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
        () => client.mergeBranch(workspaceId, promptValue),
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
    setTemplateOpen(true)
  }

  const closeTemplate = (): void => {
    setTemplateOpen(false)
  }

  const closeRestore = (): void => {
    setRestoreAsk(null)
  }

  const confirmRestore = (): void => {
    if (restoreAsk === null || workspaceId === undefined) return
    const paths = restoreAsk.paths
    setRestoreAsk(null)
    void runWrite(() => client.restore(workspaceId, paths))
  }

  const saveTemplate = (): void => {
    setCustomTemplate(writeCustomTemplate(templateDraft, localeDefault))
    setTemplateOpen(false)
  }

  return (
    <aside
      ref={rootRef}
      className={css.root}
      aria-label={t('panel.title')}
      style={{ '--git-graph-h': `${graphHFit}px`, '--git-graph-reserved': `${reserved}px` } as never}
    >
      <header className={css.head} data-git-chrome="head">
        <label className={css.branchWrap}>
          <IconBranch />
          <select
            className={css.branchSelect}
            value={status?.probe.branch ?? ''}
            disabled={writesDisabled}
            aria-label={t('branch.switch')}
            onChange={(event) => {
              const name = event.target.value
              if (workspaceId === undefined || name === status?.probe.branch) return
              void runWrite(() => client.switchBranch(workspaceId, name))
            }}
          >
            {status?.probe.detached ? <option value="">{t('panel.detached')}</option> : null}
            {branches.map(branch => (
              <option key={branch.name} value={branch.name}>{branch.name}</option>
            ))}
          </select>
        </label>
        {status !== null && status.probe.ahead > 0 ? <span className={css.chip}>{t('panel.ahead', { count: status.probe.ahead })}</span> : null}
        {status !== null && status.probe.behind > 0 ? <span className={css.chip}>{t('panel.behind', { count: status.probe.behind })}</span> : null}
        <IconButton label={t('panel.refresh')} disabled={loading || busy} onClick={() => { void refresh() }}>
          <IconRefresh />
        </IconButton>
      </header>

      {workspaceId === undefined ? <p className={css.hint} data-git-chrome="hint" style={{ padding: '8px 10px' }}>{t('panel.noWorkspace')}</p> : null}
      {error !== null ? (
        <div className={css.banner} data-git-chrome="banner">
          <div>{error.messageZh}</div>
          <div className={css.bannerHint}>{error.hintZh}</div>
        </div>
      ) : null}
      {loading && status === null ? <p className={css.hint} data-git-chrome="hint" style={{ padding: '8px 10px' }}>{t('panel.loading')}</p> : null}

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

          <section className={css.pane} data-kind="changes" data-open={changesOpen || undefined}>
            <div className={css.sectionHead} data-git-chrome="changes-head">
              <button type="button" className={css.sectionToggle} aria-expanded={changesOpen} onClick={toggleChanges}>
                <IconChevron open={changesOpen} />
                <span className={css.sectionTitle}>{t('section.changes')}</span>
                {dirtyCount > 0 ? <span className={css.sectionCount}>{dirtyCount}</span> : null}
              </button>
              <div className={css.sectionActions}>
                <IconButton
                  dense
                  label={customTemplate === null ? t('commit.template') : t('commit.templateCustom')}
                  active={customTemplate !== null}
                  onClick={openTemplate}
                >
                  <IconTune />
                </IconButton>
                {stageAllPaths.length > 0 ? (
                  <IconButton
                    dense
                    label={writesDisabled ? t('action.disabledBusy') : t('action.stageAll')}
                    disabled={writesDisabled}
                    onClick={() => {
                      if (workspaceId) void runWrite(() => client.stage(workspaceId, stageAllPaths))
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
                  onOpenDiff={onOpenDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.unstage(workspaceId, [path])) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.unstage(workspaceId, status.staged.map(file => file.path)))
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
                  onOpenDiff={onOpenDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [path])) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.stage(workspaceId, status.unstaged.map(file => file.path)))
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
                  onOpenDiff={onOpenDiff}
                  onFileAction={(path) => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [path])) }}
                  onBulkAction={() => {
                    if (workspaceId) void runWrite(() => client.stage(workspaceId, status.untracked.map(file => file.path)))
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
                  <IconFetch />
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
                  label={busy ? t('action.disabledBusy') : t('action.newBranch')}
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
                <GitGraph entries={log} emptyLabel={t('graph.empty')} compact={graphCompact} client={client} workspaceId={workspaceId} onOpenCommitDiff={onOpenCommitDiff} t={t} />
              </div>
            ) : null}
          </section>
        </>
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
                disabled={busy}
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
            <h2 id="git-commit-template-title">{t('commit.templateTitle')}</h2>
            <p>{t('commit.templateHint')}</p>
            <label className={css.field}>
              <span>{t('commit.templateTitle')}</span>
              <textarea
                className={css.templateInput}
                value={templateDraft}
                autoFocus
                onChange={(event) => { setTemplateDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeTemplate()
                }}
              />
            </label>
            <div className={css.dialogRow}>
              <button
                type="button"
                className={css.dialogCancel}
                onClick={() => { setTemplateDraft(localeDefault) }}
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
                disabled={busy || (prompt === 'merge' && promptValue.trim() === '')}
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