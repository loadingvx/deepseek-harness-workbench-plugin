import { useEffect, useState } from 'react'
import type { GitClient } from '../api.ts'
import { invalidGitUserEmail, invalidGitUserName, normalizeInitBranch } from '../../shared/git-identity.ts'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

const BRANCH_CHOICES = ['main', 'master'] as const

export function GitInitPanel({
  client, workspaceId, t, onReady,
}: {
  client: GitClient
  workspaceId: string
  t: Translate
  onReady: () => Promise<void>
}) {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [branch, setBranch] = useState<string>('main')
  const [choices, setChoices] = useState<string[]>([...BRANCH_CHOICES])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setName('')
    setEmail('')
    setBranch('main')
    setChoices([...BRANCH_CHOICES])
    setLoading(true)
    void client.identity(workspaceId).then((result) => {
      if (!live) return
      setLoading(false)
      if (!result.ok) return
      const next = result.value
      setName(next.name)
      setEmail(next.email)
      const picked = normalizeInitBranch(next.defaultBranch)
      setBranch(picked)
      setChoices(picked === 'main' || picked === 'master' ? [...BRANCH_CHOICES] : [picked, ...BRANCH_CHOICES])
    })
    return () => { live = false }
  }, [client, workspaceId])

  const blocked = busy
    || loading
    || invalidGitUserName(name) !== null
    || invalidGitUserEmail(email) !== null

  const submit = (): void => {
    if (blocked) return
    setBusy(true)
    void client.initRepo(workspaceId, {
      name,
      email,
      branch: normalizeInitBranch(branch),
    }).then(async (result) => {
      if (!result.ok) {
        setBusy(false)
        return
      }
      await onReady()
    })
  }

  return (
    <div className={css.setup} data-git-chrome="init">
      <label className={css.field}>
        <span className={css.setupCmd}>{t('init.branch')}</span>
        <select
          className={css.fieldInput}
          value={branch}
          disabled={busy || loading}
          aria-label={t('init.branch')}
          onChange={(event) => { setBranch(event.target.value) }}
        >
          {choices.map(item => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span className={css.setupCmd}>{t('init.email')}</span>
        <input
          className={css.fieldInput}
          type="email"
          value={email}
          placeholder={t('init.emailPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || loading}
          onChange={(event) => { setEmail(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>
      <label className={css.field}>
        <span className={css.setupCmd}>{t('init.name')}</span>
        <input
          className={css.fieldInput}
          value={name}
          placeholder={t('init.namePlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || loading}
          onChange={(event) => { setName(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>
      <button
        type="button"
        className={css.setupSubmit}
        data-pending={busy || undefined}
        disabled={blocked}
        onClick={submit}
      >
        {busy ? <span className={css.spinner} aria-hidden /> : null}
        {busy ? t('init.submitting') : t('init.submit')}
      </button>
    </div>
  )
}
