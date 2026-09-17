import { useEffect, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitClient } from '../../../api.ts'
import type { GitFail } from '../../../../shared/types.ts'
import type { Translate } from '../../types.ts'
import { PaneShell } from '../PaneShell.tsx'
import { parseGitDiffAddress } from './address.ts'
import { isBinaryDiff, isNewEmptyDiff, parseDiff } from './diff-parse.ts'
import css from './DiffBody.module.css'

export type DiffBodyProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & { client: GitClient; t: Translate }

/** Git diff viewer hosted as a resource tab in the official right Sidebar. */
export function DiffBody({ client, t, useTabInfo }: DiffBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const address = parseGitDiffAddress(tab.contentId) !== null
    ? tab.contentId
    : tab.navigation.address
  const parsed = parseGitDiffAddress(address)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)

  useEffect(() => {
    const target = parseGitDiffAddress(address)
    if (target === null) {
      setText('')
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const load = target.hash !== undefined
      ? client.commitDiff(target.workspaceId, target.hash, target.path, target.repo)
      : client.diff(target.workspaceId, target.path, target.staged, target.repo)
    void load.then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) {
        setError(null)
        setText(result.value.text)
      } else {
        setError(result)
        setText('')
      }
    })
    return () => { cancelled = true }
  }, [address, client, tab.navigation.revision, tab.contentId])

  if (parsed === null) {
    return (
      <PaneShell>
        <p className={css.hint}>{t('diff.empty')}</p>
      </PaneShell>
    )
  }

  const rows = parseDiff(text)
  const binary = !loading && isBinaryDiff(text)
  const newEmpty = !loading && isNewEmptyDiff(text, rows)
  const empty = !loading && rows.length === 0 && !binary && !newEmpty
  const hint = loading
    ? t('panel.loading')
    : binary
      ? t('diff.binary')
      : newEmpty
        ? t('diff.newEmpty')
        : empty
          ? t('diff.empty')
          : null

  return (
    <PaneShell>
      <div className={css.root} data-workbench-diff-pane="">
        {error !== null ? <p className={css.error}>{error.messageZh || error.hintZh}</p> : null}
        {hint !== null ? <p className={css.hint}>{hint}</p> : null}
        {rows.length > 0 && !binary && !newEmpty ? (
          <pre className={css.diff}>
            {rows.map((row, index) => (
              <div key={`${index}:${row.text.slice(0, 24)}`} className={css.diffLine} data-kind={row.kind}>
                {row.text === '' ? ' ' : row.text}
              </div>
            ))}
          </pre>
        ) : null}
      </div>
    </PaneShell>
  )
}
