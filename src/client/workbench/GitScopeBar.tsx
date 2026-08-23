import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GitBranchInfo, NearbyGitRepo } from '../../shared/types.ts'
import { IconBranch, IconCheck, IconChevron, IconGit } from './icons.tsx'
import { nearbyRepoList, type NearbyGitState } from './nearby-git.ts'
import { readDocumentColorScheme } from './surface-scheme.ts'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

type OpenMenu = 'repo' | 'branch' | null

function kindLabel(kind: NearbyGitRepo['kind'], t: Translate): string {
  if (kind === 'parent') return t('repo.parent')
  if (kind === 'child') return t('repo.child')
  if (kind === 'link') return t('repo.link')
  if (kind === 'submodule') return t('repo.submodule')
  return t('repo.current')
}

function menuStyle(rect: DOMRect): { top: number; left: number; width: number } {
  const width = Math.max(180, Math.min(rect.width, 320))
  const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8))
  return { top: rect.bottom + 4, left, width }
}

export function GitScopeBar({
  nearby,
  branches,
  branchLabel,
  currentBranch,
  detached,
  disabled,
  onSelectRepo,
  onSwitchBranch,
  t,
}: {
  nearby: NearbyGitState
  branches: GitBranchInfo[]
  branchLabel: string
  currentBranch?: string
  detached: boolean
  disabled: boolean
  onSelectRepo: (id: string) => void
  onSwitchBranch: (name: string) => void
  t: Translate
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<OpenMenu>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [scheme, setScheme] = useState<'light' | 'dark'>('light')
  const repos = nearbyRepoList(nearby)
  const selected = repos.find(repo => repo.id === nearby.selectedId) ?? repos[0]
  const repoLabel = selected?.name ?? t('panel.title')
  const repoTitle = selected === undefined
    ? t('repo.switch')
    : `${selected.name} · ${kindLabel(selected.kind, t)}`
  const branchDisabled = disabled || selected?.isRepo !== true

  useLayoutEffect(() => {
    setScheme(readDocumentColorScheme(wrapRef.current))
  }, [nearby.snapshot, nearby.selectedId])

  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const openMenu = (kind: Exclude<OpenMenu, null>, target: HTMLElement): void => {
    setPos(menuStyle(target.getBoundingClientRect()))
    setOpen(current => current === kind ? null : kind)
  }

  return (
    <>
      <div
        ref={wrapRef}
        className={css.scopeWrap}
        style={{ colorScheme: scheme }}
        data-git-chrome="scope"
      >
        <button
          type="button"
          className={css.scopeBtn}
          data-open={open === 'repo' || undefined}
          aria-haspopup="menu"
          aria-expanded={open === 'repo'}
          aria-label={t('repo.switch')}
          title={repoTitle}
          disabled={repos.length === 0}
          onClick={(event) => { openMenu('repo', event.currentTarget.parentElement ?? event.currentTarget) }}
        >
          <IconGit />
          <span className={css.scopeLabel}>{repoLabel}</span>
          <IconChevron open={open === 'repo'} />
        </button>
        <button
          type="button"
          className={css.scopeBtn}
          data-kind="branch"
          data-open={open === 'branch' || undefined}
          aria-haspopup="menu"
          aria-expanded={open === 'branch'}
          aria-label={t('branch.switch')}
          title={branchLabel}
          disabled={branchDisabled}
          onClick={(event) => { openMenu('branch', event.currentTarget.parentElement ?? event.currentTarget) }}
        >
          <IconBranch />
          <span className={css.scopeLabel}>{branchLabel}</span>
          <IconChevron open={open === 'branch'} />
        </button>
      </div>
      {open !== null && pos !== null ? (
        <>
          <div className={css.scopeBackdrop} onClick={() => { setOpen(null) }} />
          <div
            className={css.scopeMenu}
            role="menu"
            aria-label={open === 'repo' ? t('repo.switch') : t('branch.menu')}
            style={{ top: pos.top, left: pos.left, width: pos.width, colorScheme: scheme }}
          >
            {open === 'repo' ? (
              repos.length === 0 ? (
                <div className={css.scopeEmpty}>{t('repo.empty')}</div>
              ) : repos.map(repo => (
                <button
                  key={repo.id}
                  type="button"
                  role="menuitem"
                  className={css.scopeItem}
                  data-active={repo.id === nearby.selectedId || undefined}
                  title={`${repo.name} · ${kindLabel(repo.kind, t)}`}
                  onClick={() => {
                    setOpen(null)
                    onSelectRepo(repo.id)
                  }}
                >
                  {repo.id === nearby.selectedId ? <IconCheck /> : <span className={css.scopeCheckSlot} />}
                  <span className={css.scopeItemMain}>
                    <span className={css.scopeItemName}>{repo.name}</span>
                    <span className={css.scopeItemKind}>
                      {kindLabel(repo.kind, t)}
                      {repo.isRepo ? '' : ` · ${t('repo.notRepo')}`}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <>
                {detached ? (
                  <div className={css.scopeEmpty}>{t('panel.detached')}</div>
                ) : null}
                {branches.map(branch => (
                  <button
                    key={branch.name}
                    type="button"
                    role="menuitem"
                    className={css.scopeItem}
                    data-active={branch.name === currentBranch || undefined}
                    title={t('branch.switch')}
                    onClick={() => {
                      setOpen(null)
                      if (branch.name !== currentBranch) onSwitchBranch(branch.name)
                    }}
                  >
                    {branch.name === currentBranch ? <IconCheck /> : <span className={css.scopeCheckSlot} />}
                    <span className={css.scopeItemName}>{branch.name}</span>
                  </button>
                ))}
                {branches.length === 0 ? (
                  <div className={css.scopeEmpty}>{t('repo.notRepo')}</div>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}
    </>
  )
}
