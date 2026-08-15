import { useEffect, useState } from 'react'
import type { GitClient } from '../api.ts'
import type {
  GitBranchInfo, GitFail, GitFileChange, GitLogEntry, GitResult, GitStatusSnapshot,
} from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconCheck, IconMinus, IconPlus, IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

export interface GitSidebarProps {
  client: GitClient
  workspaceId?: string
  selected?: { path: string; staged: boolean } | null
  onOpenDiff: (path: string, staged: boolean) => void
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

function FileRow({
  file, active, action, actionLabel, onSelect, onAction, disabled,
}: {
  file: GitFileChange
  active: boolean
  action: 'stage' | 'unstage'
  actionLabel: string
  onSelect: () => void
  onAction: () => void
  disabled: boolean
}) {
  return (
    <li className={css.file} data-active={active || undefined}>
      <span className={css.fileKind} title={file.labelZh}>{KIND_MARK[file.kind] ?? '?'}</span>
      <button type="button" className={css.filePath} title={file.path} onClick={onSelect}>
        {file.path}
      </button>
      <button type="button" className={css.fileAction} disabled={disabled} onClick={onAction} title={actionLabel}>
        {action === 'stage' ? '+' : '−'}
      </button>
    </li>
  )
}

/** Cursor-like source-control column: commit first, then changes, then history. */
export function GitSidebar({ client, workspaceId, selected, onOpenDiff, t }: GitSidebarProps) {
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [message, setMessage] = useState('')

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
    return () => { window.clearInterval(timer) }
  }, [workspaceId])

  const runWrite = async (action: () => Promise<GitResult<unknown>>): Promise<void> => {
    if (busy) return
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result as GitFail)
      return
    }
    setError(null)
    await refresh()
  }

  const stagedCount = status?.staged.length ?? 0
  const commitDisabledReason = message.trim() === ''
    ? t('commit.disabledEmpty')
    : stagedCount === 0
      ? t('commit.disabledNothing')
      : busy
        ? t('commit.disabledBusy')
        : null
  const writesDisabled = busy || status === null || !status.probe.gitAvailable || !status.probe.isRepo
  const dirtyCount = stagedCount + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)

  return (
    <aside className={css.root} aria-label={t('panel.title')}>
      <header className={css.head}>
        <span className={css.title}>{status?.probe.branch ?? t('panel.title')}</span>
        <IconButton label={t('panel.refresh')} disabled={loading || busy} onClick={() => { void refresh() }}>
          <IconRefresh />
        </IconButton>
      </header>
      <div className={css.body}>
        {workspaceId === undefined ? <p className={css.hint}>{t('panel.noWorkspace')}</p> : null}
        {error !== null ? (
          <div className={css.banner}>
            <div>{error.messageZh}</div>
            <div className={css.bannerHint}>{error.hintZh}</div>
            <IconButton label={t('panel.retry')} onClick={() => { void refresh() }}><IconRefresh /></IconButton>
          </div>
        ) : null}
        {loading && status === null ? <p className={css.hint}>{t('panel.loading')}</p> : null}
        {status !== null && status.probe.isRepo ? (
          <>
            <div className={css.meta}>
              <select
                className={css.select}
                value={status.probe.branch ?? ''}
                disabled={writesDisabled}
                aria-label={t('branch.switch')}
                onChange={(event) => {
                  const name = event.target.value
                  if (workspaceId === undefined || name === status.probe.branch) return
                  void runWrite(() => client.switchBranch(workspaceId, name))
                }}
              >
                {status.probe.detached ? <option value="">{t('panel.detached')}</option> : null}
                {branches.map(branch => (
                  <option key={branch.name} value={branch.name}>{branch.name}</option>
                ))}
              </select>
              {status.probe.ahead > 0 ? <span className={css.chip}>{t('panel.ahead', { count: status.probe.ahead })}</span> : null}
              {status.probe.behind > 0 ? <span className={css.chip}>{t('panel.behind', { count: status.probe.behind })}</span> : null}
            </div>
            <div className={css.commitBox}>
              <textarea
                className={css.textarea}
                value={message}
                placeholder={t('commit.placeholder')}
                disabled={writesDisabled}
                onChange={(event) => { setMessage(event.target.value) }}
              />
              <div className={css.commitRow}>
                <IconButton
                  label={commitDisabledReason ?? t('action.commit')}
                  disabled={commitDisabledReason !== null || writesDisabled}
                  onClick={() => {
                    if (workspaceId === undefined) return
                    void runWrite(async () => {
                      const result = await client.commit(workspaceId, message)
                      if (result.ok) setMessage('')
                      return result
                    })
                  }}
                >
                  <IconCheck />
                </IconButton>
              </div>
            </div>
            {dirtyCount === 0 ? <p className={css.hint}>{t('panel.empty')}</p> : null}
            {status.staged.length > 0 ? (
              <section className={css.section}>
                <div className={css.sectionTitle}>
                  {t('section.staged')}
                  <span className={css.count}>{status.staged.length}</span>
                  <IconButton
                    label={t('action.unstageAll')}
                    disabled={writesDisabled}
                    onClick={() => {
                      if (workspaceId) void runWrite(() => client.unstage(workspaceId, status.staged.map(file => file.path)))
                    }}
                  >
                    <IconMinus />
                  </IconButton>
                </div>
                <ul className={css.files}>
                  {status.staged.map(file => (
                    <FileRow
                      key={`s:${file.path}`}
                      file={file}
                      active={selected?.path === file.path && selected.staged}
                      action="unstage"
                      actionLabel={t('action.unstage')}
                      disabled={writesDisabled}
                      onSelect={() => { onOpenDiff(file.path, true) }}
                      onAction={() => { if (workspaceId) void runWrite(() => client.unstage(workspaceId, [file.path])) }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {status.unstaged.length > 0 ? (
              <section className={css.section}>
                <div className={css.sectionTitle}>
                  {t('section.unstaged')}
                  <span className={css.count}>{status.unstaged.length}</span>
                  <IconButton
                    label={t('action.stageAll')}
                    disabled={writesDisabled}
                    onClick={() => {
                      if (workspaceId) void runWrite(() => client.stage(workspaceId, status.unstaged.map(file => file.path)))
                    }}
                  >
                    <IconPlus />
                  </IconButton>
                </div>
                <ul className={css.files}>
                  {status.unstaged.map(file => (
                    <FileRow
                      key={`u:${file.path}`}
                      file={file}
                      active={selected?.path === file.path && !selected.staged}
                      action="stage"
                      actionLabel={t('action.stage')}
                      disabled={writesDisabled}
                      onSelect={() => { onOpenDiff(file.path, false) }}
                      onAction={() => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [file.path])) }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {status.untracked.length > 0 ? (
              <section className={css.section}>
                <div className={css.sectionTitle}>
                  {t('section.untracked')}
                  <span className={css.count}>{status.untracked.length}</span>
                  <IconButton
                    label={t('action.stageAll')}
                    disabled={writesDisabled}
                    onClick={() => {
                      if (workspaceId) void runWrite(() => client.stage(workspaceId, status.untracked.map(file => file.path)))
                    }}
                  >
                    <IconPlus />
                  </IconButton>
                </div>
                <ul className={css.files}>
                  {status.untracked.map(file => (
                    <FileRow
                      key={`n:${file.path}`}
                      file={file}
                      active={selected?.path === file.path && !selected.staged}
                      action="stage"
                      actionLabel={t('action.stage')}
                      disabled={writesDisabled}
                      onSelect={() => { onOpenDiff(file.path, false) }}
                      onAction={() => { if (workspaceId) void runWrite(() => client.stage(workspaceId, [file.path])) }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {log.length > 0 ? (
              <section className={css.section}>
                <div className={css.sectionTitle}>{t('log.title')}</div>
                <ol className={css.log}>
                  {log.map(entry => (
                    <li key={entry.hash}>
                      <span>{entry.subject}</span>
                      <span className={css.hash}>{entry.shortHash} · {entry.author}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  )
}
