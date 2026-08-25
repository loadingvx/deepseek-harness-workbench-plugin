/**
 * Control Plane Skills / Rules manager: list, toggle, create, edit, delete.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import {
  MAX_RULES,
  MAX_SKILLS,
  validateAssetDraft,
  type AgentAsset,
  type AgentAssetDraft,
  type AgentAssetFamily,
  type AgentAssetOrigin,
  type AssetIssue,
} from '../../shared/agent-assets.ts'
import type { Translate } from './types.ts'
import css from './AgentAssetsView.module.css'

export interface AgentAssetsViewProps {
  client: GitClient
  workspaceId?: string
  family: AgentAssetFamily
  reloadToken: number
  t: Translate
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; name: string; relPath: string; origin: AgentAssetOrigin }

const EMPTY_DRAFT: AgentAssetDraft = {
  name: '',
  description: '',
  whenToUse: '',
  content: '',
  enabled: true,
}

function failText(result: GitFail, fallback: string): string {
  const msg = result.messageZh?.trim() ?? ''
  return msg === '' ? fallback : msg
}

function issueText(issue: AssetIssue, t: Translate): string {
  switch (issue.code) {
    case 'name.empty': return t('assets.issue.nameEmpty')
    case 'name.invalid': return t('assets.issue.nameInvalid')
    case 'name.tooLong': return t('assets.issue.nameTooLong', { max: issue.max })
    case 'name.taken': return t('assets.issue.nameTaken', { name: issue.name })
    case 'description.empty': return t('assets.issue.descriptionEmpty')
    case 'description.tooLong': return t('assets.issue.descriptionTooLong', { max: issue.max })
    case 'when.tooLong': return t('assets.issue.whenTooLong', { max: issue.max })
    case 'content.empty': return t('assets.issue.contentEmpty')
    case 'content.tooLong': return t('assets.issue.contentTooLong', { max: issue.max })
    case 'tooMany': return t('assets.issue.tooMany', { max: issue.max })
  }
}

function originKey(origin: AgentAsset['origin']): string {
  return `assets.origin.${origin}`
}

export function AgentAssetsView({ client, workspaceId, family, reloadToken, t }: AgentAssetsViewProps) {
  const [items, setItems] = useState<AgentAsset[]>([])
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [draft, setDraft] = useState<AgentAssetDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState<AgentAssetDraft>(EMPTY_DRAFT)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [fieldIssue, setFieldIssue] = useState<AssetIssue | null>(null)

  const reload = useCallback(async (): Promise<boolean> => {
    if (workspaceId === undefined || workspaceId === '') {
      setLoad('error')
      setLoadError(t('assets.noWorkspace'))
      setItems([])
      return false
    }
    setLoad('loading')
    const result = family === 'skill'
      ? await client.listSkills(workspaceId)
      : await client.listRules(workspaceId)
    if (!result.ok) {
      setLoad('error')
      setLoadError(failText(result, t('assets.loadFail')))
      return false
    }
    setItems(result.value.items)
    setLoad('ready')
    setLoadError('')
    return true
  }, [client, family, t, workspaceId])

  useEffect(() => {
    setMode({ kind: 'list' })
    setDraft(EMPTY_DRAFT)
    setBaseline(EMPTY_DRAFT)
    setFieldIssue(null)
    setConfirmDelete(null)
    setConfirmDiscard(false)
    setError(null)
    setNotice(null)
    setQuery('')
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload, reloadToken])

  const managed = useMemo(
    () => items.filter(item => item.origin !== 'instruction'),
    [items],
  )
  const instructions = useMemo(
    () => items.filter(item => item.origin === 'instruction'),
    [items],
  )

  const filteredManaged = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return managed
    return managed.filter(item => (
      item.name.includes(q)
      || item.description.toLowerCase().includes(q)
      || item.relPath.toLowerCase().includes(q)
    ))
  }, [managed, query])

  const dirty = mode.kind !== 'list' && (
    draft.name !== baseline.name
    || draft.description !== baseline.description
    || (draft.whenToUse ?? '') !== (baseline.whenToUse ?? '')
    || draft.content !== baseline.content
    || draft.enabled !== baseline.enabled
  )

  const filteredInstructions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return instructions
    return instructions.filter(item => (
      item.name.includes(q)
      || item.relPath.toLowerCase().includes(q)
      || item.content.toLowerCase().includes(q)
    ))
  }, [instructions, query])
  const taken = useMemo(() => new Set(managed.map(item => item.name)), [managed])
  const maxItems = family === 'skill' ? MAX_SKILLS : MAX_RULES
  const atCap = managed.length >= maxItems

  const openCreate = (): void => {
    if (busy || atCap) return
    setError(null)
    setNotice(null)
    setFieldIssue(null)
    setConfirmDelete(null)
    setDraft(EMPTY_DRAFT)
    setBaseline(EMPTY_DRAFT)
    setMode({ kind: 'create' })
  }

  const openEdit = (item: AgentAsset): void => {
    if (busy || !item.writable) return
    const next: AgentAssetDraft = {
      name: item.name,
      description: item.description,
      whenToUse: item.whenToUse,
      content: item.content,
      enabled: item.enabled,
    }
    setError(null)
    setNotice(null)
    setFieldIssue(null)
    setConfirmDelete(null)
    setDraft(next)
    setBaseline(next)
    setMode({ kind: 'edit', name: item.name, relPath: item.relPath, origin: item.origin })
  }

  const leaveEditor = (): void => {
    setConfirmDiscard(false)
    setMode({ kind: 'list' })
    setDraft(EMPTY_DRAFT)
    setBaseline(EMPTY_DRAFT)
    setFieldIssue(null)
  }

  const requestBack = (): void => {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    leaveEditor()
  }

  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) {
      setError(t('assets.busy'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const onToggle = (item: AgentAsset, enabled: boolean): void => {
    if (!item.canToggle) return
    void run(async () => {
      if (workspaceId === undefined) return
      const result = family === 'skill'
        ? await client.enableSkill(workspaceId, item.name, enabled, item.relPath)
        : await client.enableRule(workspaceId, item.name, enabled, item.relPath)
      if (!result.ok) {
        setError(failText(result, t('assets.loadFail')))
        return
      }
      setItems(current => current.map(row => row.relPath === item.relPath ? result.value : row))
      setNotice(t(enabled ? 'assets.toggledOn' : 'assets.toggledOff', { name: item.name }))
    })
  }

  const onDelete = (item: AgentAsset): void => {
    void run(async () => {
      if (workspaceId === undefined) return
      const result = family === 'skill'
        ? await client.deleteSkill(workspaceId, item.name, item.relPath)
        : await client.deleteRule(workspaceId, item.name, item.relPath)
      if (!result.ok) {
        setError(failText(result, t('assets.loadFail')))
        return
      }
      setConfirmDelete(null)
      setItems(current => current.filter(row => row.relPath !== item.relPath))
      setNotice(t('assets.deleted', { name: item.name }))
    })
  }

  const onSave = (): void => {
    if (mode.kind === 'edit' && mode.origin === 'instruction') {
      if (draft.content.trim() === '') {
        const issue: AssetIssue = { code: 'content.empty' }
        setFieldIssue(issue)
        setError(issueText(issue, t))
        return
      }
      void run(async () => {
        if (workspaceId === undefined) return
        const result = await client.updateRule(workspaceId, mode.name, { content: draft.content }, mode.relPath)
        if (!result.ok) {
          setError(failText(result, t('assets.loadFail')))
          return
        }
        setNotice(t('assets.saved'))
        leaveEditor()
        await reload()
      })
      return
    }
    const checked = validateAssetDraft(draft, {
      taken,
      maxItems,
      itemCount: managed.length,
      renaming: mode.kind === 'edit' ? mode.name : undefined,
    })
    if (!checked.ok) {
      setFieldIssue(checked.issue)
      setError(issueText(checked.issue, t))
      return
    }
    void run(async () => {
      if (workspaceId === undefined) return
      const relPath = mode.kind === 'edit' ? mode.relPath : undefined
      const result = mode.kind === 'create'
        ? (family === 'skill'
          ? await client.createSkill(workspaceId, checked.value)
          : await client.createRule(workspaceId, checked.value))
        : (family === 'skill'
          ? await client.updateSkill(workspaceId, mode.kind === 'edit' ? mode.name : checked.value.name, checked.value, relPath)
          : await client.updateRule(workspaceId, mode.kind === 'edit' ? mode.name : checked.value.name, checked.value, relPath))
      if (!result.ok) {
        setError(failText(result, t('assets.loadFail')))
        return
      }
      setNotice(t('assets.saved'))
      leaveEditor()
      await reload()
    })
  }

  if (workspaceId === undefined || workspaceId === '') {
    return (
      <div className={css.root}>
        <p className={css.empty}>{t('assets.noWorkspace')}</p>
      </div>
    )
  }

  if (mode.kind !== 'list') {
    const editingInstruction = mode.kind === 'edit' && mode.origin === 'instruction'
    const title = mode.kind === 'create'
      ? t(family === 'skill' ? 'assets.editor.newSkill' : 'assets.editor.newRule')
      : editingInstruction
        ? t('assets.editor.editInstruction')
        : t(family === 'skill' ? 'assets.editor.editSkill' : 'assets.editor.editRule')
    const nameLocked = mode.kind === 'edit'
    return (
      <div className={css.root}>
        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
          }}
        >
          <div className={css.formHead}>
            <button type="button" className={css.btnGhost} disabled={busy} onClick={requestBack}>
              {t('assets.editor.back')}
            </button>
            <h2 className={css.formTitle}>{title}</h2>
          </div>
          {editingInstruction ? <p className={css.hint}>{t('assets.instructionHint')}</p> : null}
          {error !== null ? <p className={css.error} role="alert">{error}</p> : null}
          {confirmDiscard ? (
            <div className={css.banner} role="alertdialog">
              <p>{t('assets.editor.discardTitle')}</p>
              <div className={css.actions}>
                <button type="button" className={css.btnDanger} onClick={leaveEditor}>{t('assets.editor.discard')}</button>
                <button type="button" className={css.btnGhost} onClick={() => setConfirmDiscard(false)}>{t('assets.editor.keep')}</button>
              </div>
            </div>
          ) : null}

          {editingInstruction ? (
            <p className={css.path}>{t('assets.path')} {mode.relPath}</p>
          ) : (
            <>
              <label className={css.label}>
                {t('assets.field.name')}
                <input
                  className={css.input}
                  value={draft.name}
                  disabled={busy || nameLocked}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(family === 'skill' ? 'assets.field.namePhSkill' : 'assets.field.namePhRule')}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value })
                    setFieldIssue(null)
                  }}
                />
                <span className={css.hint}>{t('assets.field.nameHint')}</span>
                {fieldIssue?.code.startsWith('name.') === true ? (
                  <span className={css.fieldError}>{issueText(fieldIssue, t)}</span>
                ) : null}
              </label>

              <label className={css.label}>
                {t('assets.field.description')}
                <input
                  className={css.input}
                  value={draft.description}
                  disabled={busy}
                  placeholder={t(family === 'skill' ? 'assets.field.descriptionPhSkill' : 'assets.field.descriptionPhRule')}
                  onChange={(event) => {
                    setDraft({ ...draft, description: event.target.value })
                    setFieldIssue(null)
                  }}
                />
                {fieldIssue?.code.startsWith('description.') === true ? (
                  <span className={css.fieldError}>{issueText(fieldIssue, t)}</span>
                ) : null}
              </label>

              {family === 'skill' ? (
                <label className={css.label}>
                  {t('assets.field.when')}
                  <input
                    className={css.input}
                    value={draft.whenToUse ?? ''}
                    disabled={busy}
                    placeholder={t('assets.field.whenPh')}
                    onChange={(event) => {
                      setDraft({ ...draft, whenToUse: event.target.value })
                      setFieldIssue(null)
                    }}
                  />
                </label>
              ) : null}
            </>
          )}

          <label className={css.label}>
            {t('assets.field.content')}
            <textarea
              className={css.textarea}
              value={draft.content}
              disabled={busy}
              placeholder={t(family === 'skill' ? 'assets.field.contentPhSkill' : 'assets.field.contentPhRule')}
              onChange={(event) => {
                setDraft({ ...draft, content: event.target.value })
                setFieldIssue(null)
              }}
            />
            {fieldIssue?.code.startsWith('content.') === true ? (
              <span className={css.fieldError}>{issueText(fieldIssue, t)}</span>
            ) : null}
          </label>

          {editingInstruction ? null : (
            <label className={css.check}>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              <span>
                {t('assets.field.enabled')}
                <span className={css.hint}>
                  {t(family === 'skill' ? 'assets.field.enabledHintSkill' : 'assets.field.enabledHintRule')}
                </span>
              </span>
            </label>
          )}

          <div className={css.actions}>
            <button type="submit" className={css.btn} disabled={busy}>
              {busy ? t('assets.saving') : t('assets.save')}
            </button>
            <button type="button" className={css.btnGhost} disabled={busy} onClick={requestBack}>
              {t('assets.cancel')}
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <input
          className={css.search}
          value={query}
          placeholder={t('assets.searchPh')}
          aria-label={t('assets.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {load === 'ready' ? (
          <span className={css.count}>
            {t('assets.count', { on: managed.filter(item => item.enabled).length, total: managed.length })}
          </span>
        ) : null}
        <button
          type="button"
          className={css.btn}
          disabled={busy || atCap || load !== 'ready'}
          title={atCap ? t(family === 'skill' ? 'assets.maxSkill' : 'assets.maxRule', { max: maxItems }) : undefined}
          onClick={openCreate}
        >
          {t(family === 'skill' ? 'assets.newSkill' : 'assets.newRule')}
        </button>
      </div>
      <div className={css.scroll}>
        {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
        {error !== null ? <p className={css.error} role="alert">{error}</p> : null}
        {load === 'loading' ? <p className={css.banner} role="status">{t('assets.loading')}</p> : null}
        {load === 'error' ? (
          <div className={css.error} role="alert">
            <p>{loadError}</p>
            <button type="button" className={css.btnGhost} onClick={() => { void reload() }}>{t('assets.retry')}</button>
          </div>
        ) : null}
        {atCap ? (
          <p className={css.banner}>{t(family === 'skill' ? 'assets.maxSkill' : 'assets.maxRule', { max: maxItems })}</p>
        ) : null}

        {load === 'ready' && managed.length === 0 && query.trim() === '' ? (
          <p className={css.empty}>{t(family === 'skill' ? 'assets.emptySkill' : 'assets.emptyRule')}</p>
        ) : null}
        {load === 'ready' && filteredManaged.length === 0 && filteredInstructions.length === 0 && query.trim() !== '' ? (
          <p className={css.empty}>{t('assets.emptyFilter', { query: query.trim() })}</p>
        ) : null}

        {filteredManaged.length > 0 ? (
          <>
            {family === 'rule' && (instructions.length > 0 || filteredInstructions.length > 0) ? (
              <h3 className={css.sectionTitle}>{t('assets.section.managed')}</h3>
            ) : null}
            <ul className={css.list}>
              {filteredManaged.map(item => (
                <AssetCard
                  key={item.relPath}
                  item={item}
                  busy={busy}
                  deleting={confirmDelete === item.relPath}
                  family={family}
                  t={t}
                  onToggle={onToggle}
                  onEdit={openEdit}
                  onAskDelete={(relPath) => setConfirmDelete(relPath)}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onConfirmDelete={onDelete}
                />
              ))}
            </ul>
          </>
        ) : null}

        {family === 'rule' && filteredInstructions.length > 0 ? (
          <>
            <h3 className={css.sectionTitle}>{t('assets.section.instruction')}</h3>
            <p className={css.sectionHint}>{t('assets.instructionHint')}</p>
            <ul className={css.list}>
              {filteredInstructions.map(item => (
                <AssetCard
                  key={item.relPath}
                  item={item}
                  busy={busy}
                  deleting={false}
                  family={family}
                  t={t}
                  onToggle={onToggle}
                  onEdit={openEdit}
                  onAskDelete={() => {}}
                  onCancelDelete={() => {}}
                  onConfirmDelete={() => {}}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  )
}

function AssetCard({
  item,
  busy,
  deleting,
  family,
  t,
  onToggle,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  item: AgentAsset
  busy: boolean
  deleting: boolean
  family: AgentAssetFamily
  t: Translate
  onToggle: (item: AgentAsset, enabled: boolean) => void
  onEdit: (item: AgentAsset) => void
  onAskDelete: (relPath: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (item: AgentAsset) => void
}) {
  return (
    <li className={css.card} data-off={!item.enabled || undefined}>
      <div className={css.cardHead}>
        <div className={css.cardText}>
          <span className={css.name}>{item.origin === 'instruction' ? item.relPath : item.name}</span>
          {item.description !== '' && item.description !== item.name ? (
            <p className={css.desc}>{item.description}</p>
          ) : null}
        </div>
        {item.canToggle ? (
          <label className={css.toggle}>
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={busy}
              aria-label={item.enabled ? t('assets.toggleOff') : t('assets.toggleOn')}
              onChange={(event) => onToggle(item, event.target.checked)}
            />
            {item.enabled ? t('assets.enabled') : t('assets.disabled')}
          </label>
        ) : (
          <span className={css.pill} data-tone="off">{t('assets.noToggle')}</span>
        )}
      </div>
      <div className={css.meta}>
        <span className={css.pill}>{t(originKey(item.origin))}</span>
        {!item.writable ? <span className={css.pill}>{t('assets.readonly')}</span> : null}
      </div>
      <p className={css.path} title={item.relPath}>{t('assets.path')} {item.relPath}</p>
      {deleting ? (
        <div className={css.actions}>
          <p className={css.error}>
            {t(family === 'skill' ? 'assets.deleteConfirmSkill' : 'assets.deleteConfirmRule', { name: item.name })}
          </p>
          <button type="button" className={css.btnDanger} disabled={busy} onClick={() => onConfirmDelete(item)}>
            {t('assets.deleteYes')}
          </button>
          <button type="button" className={css.btnGhost} disabled={busy} onClick={onCancelDelete}>
            {t('assets.cancel')}
          </button>
        </div>
      ) : (
        <div className={css.actions}>
          {item.writable ? (
            <button type="button" className={css.btnGhost} disabled={busy} onClick={() => onEdit(item)}>
              {t('assets.edit')}
            </button>
          ) : null}
          {item.canDelete ? (
            <button type="button" className={css.btnDanger} disabled={busy} onClick={() => onAskDelete(item.relPath)}>
              {t('assets.delete')}
            </button>
          ) : null}
        </div>
      )}
    </li>
  )
}
