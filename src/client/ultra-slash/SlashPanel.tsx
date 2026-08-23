import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import {
  BUILTIN_SLASH_COMMANDS,
  CONFIGURABLE_DEFAULT_NAMES,
  MAX_CUSTOM_COMMANDS,
  normalizeCommandName,
  validateCustomCommand,
  type BuiltinDefaults,
  type BuiltinSlashCommand,
  type ConfigurableDefaultName,
  type CustomSlashCommand,
} from '../../shared/ultra-slash/catalog.ts'
import { formatCatalogIssue, type UiLocale } from '../../shared/ultra-slash/locales.ts'
import type { CatalogCache } from './catalog-api.ts'
import css from './SlashPanel.module.css'
import { getSlashCache, getSlashI18n, subscribeSlashI18n } from './runtime.ts'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface SettingsSectionProps {
  t: Translate
  locale: UiLocale
  cache: CatalogCache
  /** 嵌在外部折叠分区里时隐藏自带的大标题与引导文案（避免与分区头重复）。 */
  embedded?: boolean
}

interface Draft {
  name: string
  description: string
  steerText: string
}

const EMPTY: Draft = { name: '', description: '', steerText: '' }

function slash(name: string): string {
  return `/${name}`
}

function kindTagKey(kind: BuiltinSlashCommand['kind']): string {
  return kind === 'steer'
    ? 'settings.rowKindSteer'
    : kind === 'session'
      ? 'settings.rowKindSession'
      : 'settings.rowKindAlias'
}

function configurableName(name: string): ConfigurableDefaultName | null {
  return (CONFIGURABLE_DEFAULT_NAMES as readonly string[]).includes(name)
    ? name as ConfigurableDefaultName
    : null
}

function defaultLabelKey(name: ConfigurableDefaultName): string {
  return name === 'new' ? 'defaults.labelNew' : name === 'skill' ? 'defaults.labelSkill' : 'defaults.labelDocs'
}

/** Shipped default prompt text per configurable builtin (localized). */
export function builtinPayloadDefaults(t: Translate): BuiltinDefaults {
  const out: BuiltinDefaults = {}
  for (const name of CONFIGURABLE_DEFAULT_NAMES) {
    const command = BUILTIN_SLASH_COMMANDS.find(c => c.name === name)
    if (command?.payloadKey !== undefined) out[name] = t(command.payloadKey)
  }
  return out
}

function takenNames(commands: readonly CustomSlashCommand[], except?: string): Set<string> {
  const names = new Set<string>()
  for (const command of commands) {
    if (command.name !== except) names.add(command.name)
  }
  return names
}

export function SlashPanel() {
  const i18n = useSyncExternalStore(subscribeSlashI18n, getSlashI18n, getSlashI18n)
  return (
    <div className={css.dock}>
      <SettingsSection t={i18n.t} locale={i18n.locale} cache={getSlashCache()} />
    </div>
  )
}

export function SettingsSection({ t, locale, cache, embedded = false }: SettingsSectionProps) {
  const [commands, setCommands] = useState<readonly CustomSlashCommand[]>(() => cache.list())
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [warning, setWarning] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    return cache.subscribe(() => {
      setCommands(cache.list())
      // Keep the shipped payload visible: cached (persisted) values override,
      // anything unset falls back to the built-in default text.
      setDefaultsDraft({ ...builtinPayloadDefaults(t), ...cache.defaults() })
    })
  }, [cache, t])

  useEffect(() => {
    let live = true
    setLoad('loading')
    void cache.refresh().then((result) => {
      if (!live) return
      if (result.ok) {
        setLoad('ready')
        setLoadError('')
        setWarning(result.warning ?? '')
        return
      }
      setLoad('error')
      setLoadError(result.message)
    })
    return () => {
      live = false
    }
  }, [cache])

  const previewName = normalizeCommandName(draft.name)
  const addCheck = useMemo(
    () => validateCustomCommand(draft, takenNames(commands)),
    [draft, commands],
  )

  const saveList = async (next: CustomSlashCommand[], okText: string): Promise<boolean> => {
    setBusy(true)
    setNotice(null)
    const result = await cache.save(next, cache.defaults())
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.message })
      return false
    }
    setNotice({ kind: 'ok', text: okText })
    setConfirmDelete(null)
    setWarning('')
    return true
  }

  // ---- builtin default prompts (persisted with the custom list) ----
  // Prefilled with the shipped default text so the user sees exactly what will
  // be injected; their own persisted values override when present.
  const [defaultsDraft, setDefaultsDraft] = useState<BuiltinDefaults>(() => ({
    ...builtinPayloadDefaults(t),
    ...cache.defaults(),
  }))
  const [defaultsBusy, setDefaultsBusy] = useState(false)
  const [defaultsNotice, setDefaultsNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const onSaveDefaults = async (): Promise<void> => {
    if (defaultsBusy) return
    setDefaultsBusy(true)
    setDefaultsNotice(null)
    const result = await cache.save(cache.list(), defaultsDraft)
    setDefaultsBusy(false)
    if (!result.ok) {
      setDefaultsNotice({ kind: 'error', text: result.message })
      return
    }
    setDefaultsNotice({ kind: 'ok', text: t('defaults.saved') })
  }

  const onAdd = async (): Promise<void> => {
    if (busy || !addCheck.ok) return
    const ok = await saveList(
      [...commands, addCheck.command],
      t('settings.added', { slash: slash(addCheck.command.name) }),
    )
    if (ok) setDraft(EMPTY)
  }

  const onSaveEdit = async (original: string): Promise<void> => {
    if (busy) return
    const check = validateCustomCommand(editDraft, takenNames(commands, original))
    if (!check.ok) {
      setNotice({ kind: 'error', text: formatCatalogIssue(locale, check.issue) })
      return
    }
    const next = commands.map((command) => command.name === original ? check.command : command)
    const ok = await saveList(next, t('settings.saved', { slash: slash(check.command.name) }))
    if (ok) {
      setEditing(null)
      setEditDraft(EMPTY)
    }
  }

  const onDelete = async (name: string): Promise<void> => {
    if (busy) return
    const next = commands.filter((command) => command.name !== name)
    const ok = await saveList(next, t('settings.deleted', { slash: slash(name) }))
    if (ok) setEditing(null)
  }

  return (
    <div className={css.section}>
      {embedded ? null : (
        <>
          <h2 className={css.heading}>{t('settings.title')}</h2>
          <p className={css.intro}>{t('settings.intro')}</p>
        </>
      )}

      {/* 内置命令的默认内容：每个基本命令一行，标签 + 说明 + guidance 设置（只保留设置区）。 */}
      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('settings.builtinTitle')}</h3>
        <p className={css.blockHint}>{t('defaults.hint')}</p>
        <div className={css.defaultsList}>
          {BUILTIN_SLASH_COMMANDS.map((command) => {
            const defaultName = configurableName(command.name)
            return (
              <div key={command.name} className={css.defaultsRow}>
                <div className={css.defaultsHead}>
                  <span className={css.slash}>{slash(command.name)}</span>
                  <span className={css.kind}>{t(kindTagKey(command.kind))}</span>
                </div>
                <p className={css.desc}>{t(command.descriptionKey)}</p>
                {defaultName !== null ? (
                  <>
                    <label className={css.defaultsLabel} htmlFor={'default-' + defaultName}>
                      {t(defaultLabelKey(defaultName))}
                    </label>
                    <textarea
                      id={'default-' + defaultName}
                      className={css.defaultsTextarea}
                      value={defaultsDraft[defaultName] ?? ''}
                      disabled={defaultsBusy}
                      placeholder={defaultName === 'new' ? t('defaults.placeholderNew') : t('defaults.placeholder')}
                      onChange={(event) => {
                        const next = { ...defaultsDraft }
                        const text = event.target.value
                        if (text.trim().length === 0) delete next[defaultName]
                        else next[defaultName] = text
                        setDefaultsDraft(next)
                      }}
                    />
                    {(defaultsDraft[defaultName] ?? '') === '' ? (
                      <p className={css.hint}>{t('defaults.fallback')}</p>
                    ) : null}
                  </>
                ) : (
                  <p className={css.hint}>{t('defaults.steerManual')}</p>
                )}
              </div>
            )
          })}
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.btn + ' ' + css.primary}
            disabled={defaultsBusy}
            onClick={() => { void onSaveDefaults() }}
          >
            {defaultsBusy ? t('defaults.saving') : t('defaults.save')}
          </button>
          {defaultsNotice !== null ? (
            <p className={defaultsNotice.kind === 'ok' ? css.ok : css.error} role="status">{defaultsNotice.text}</p>
          ) : null}
        </div>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('settings.customTitle')}</h3>
        <p className={css.blockHint}>{t('settings.customHint')}</p>

        {load === 'loading' ? <p className={css.status} role="status">{t('settings.loading')}</p> : null}
        {load === 'error' ? (
          <div className={css.banner} role="alert">
            <p className={css.error}>{t('settings.loadFailed')} {loadError}</p>
            <div>
              <button
                type="button"
                className={`${css.btn} ${css.primary}`}
                onClick={() => {
                  setLoad('loading')
                  void cache.refresh().then((result) => {
                    if (result.ok) {
                      setLoad('ready')
                      setLoadError('')
                      setWarning(result.warning ?? '')
                      return
                    }
                    setLoad('error')
                    setLoadError(result.message)
                  })
                }}
              >
                {t('settings.retry')}
              </button>
            </div>
          </div>
        ) : null}

        {warning !== '' ? <p className={css.error} role="status">{warning}</p> : null}

        {load === 'ready' && commands.length === 0 && warning === '' ? (
          <p className={css.status}>{t('settings.empty')}</p>
        ) : null}

        {load === 'ready' ? (
          <ul className={css.list}>
            {commands.map((command) => {
              const isEditing = editing === command.name
              const deleting = confirmDelete === command.name
              return (
                <li key={command.name} className={css.card}>
                  {isEditing ? (
                    <CommandForm
                      t={t}
                      locale={locale}
                      draft={editDraft}
                      taken={takenNames(commands, command.name)}
                      busy={busy}
                      submitLabel={t('settings.save')}
                      submittingLabel={t('settings.saving')}
                      onChange={setEditDraft}
                      onSubmit={() => { void onSaveEdit(command.name) }}
                      onCancel={() => {
                        setEditing(null)
                        setEditDraft(EMPTY)
                        setNotice(null)
                      }}
                    />
                  ) : (
                    <>
                      <div className={css.cardHead}>
                        <div className={css.grow}>
                          <div className={css.slash}>{slash(command.name)}</div>
                          <p className={css.desc}>{command.description}</p>
                        </div>
                        <span className={css.kind}>{t('settings.rowKindCustom')}</span>
                      </div>
                      <p className={css.payload}>{command.steerText}</p>
                      {deleting ? (
                        <div className={css.actions}>
                          <p className={css.error}>{t('settings.deleteConfirm', { slash: slash(command.name) })}</p>
                          <button
                            type="button"
                            className={`${css.btn} ${css.danger}`}
                            disabled={busy}
                            onClick={() => { void onDelete(command.name) }}
                          >
                            {t('settings.deleteYes')}
                          </button>
                          <button
                            type="button"
                            className={css.btn}
                            disabled={busy}
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t('settings.cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className={css.actions}>
                          <button
                            type="button"
                            className={css.btn}
                            disabled={busy}
                            onClick={() => {
                              setEditing(command.name)
                              setEditDraft({
                                name: command.name,
                                description: command.description,
                                steerText: command.steerText,
                              })
                              setConfirmDelete(null)
                              setNotice(null)
                            }}
                          >
                            {t('settings.edit')}
                          </button>
                          <button
                            type="button"
                            className={`${css.btn} ${css.danger}`}
                            disabled={busy}
                            onClick={() => setConfirmDelete(command.name)}
                          >
                            {t('settings.delete')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        ) : null}

        {load === 'ready' && commands.length >= MAX_CUSTOM_COMMANDS ? (
          <p className={css.error}>{t('settings.maxReached', { max: MAX_CUSTOM_COMMANDS })}</p>
        ) : null}

        {load === 'ready' && commands.length < MAX_CUSTOM_COMMANDS ? (
          <div className={css.card}>
            <CommandForm
              t={t}
              locale={locale}
              draft={draft}
              taken={takenNames(commands)}
              busy={busy}
              submitLabel={t('settings.add')}
              submittingLabel={t('settings.adding')}
              previewName={previewName}
              onChange={setDraft}
              onSubmit={() => { void onAdd() }}
            />
          </div>
        ) : null}

        {notice !== null ? (
          <p className={notice.kind === 'ok' ? css.ok : css.error} role="status">{notice.text}</p>
        ) : null}
      </section>
    </div>
  )
}

function CommandForm(props: {
  t: Translate
  locale: UiLocale
  draft: Draft
  taken: ReadonlySet<string>
  busy: boolean
  submitLabel: string
  submittingLabel: string
  previewName?: string
  onChange: (draft: Draft) => void
  onSubmit: () => void
  onCancel?: () => void
}) {
  const formId = useId()
  const check = validateCustomCommand(props.draft, props.taken)
  const pristine = props.draft.name === '' && props.draft.description === '' && props.draft.steerText === ''
  const nameIssue = !pristine && !check.ok && check.issue.code.startsWith('name.') ? check.issue : null
  const textIssue = !pristine && !check.ok && check.issue.code.startsWith('text.') ? check.issue : null
  const descriptionIssue = !pristine && !check.ok && check.issue.code === 'description.tooLong' ? check.issue : null
  const preview = props.previewName !== undefined && props.previewName.length > 0
    ? slash(props.previewName)
    : null
  const blocked = props.busy || !check.ok
  const ids = {
    name: `${formId}-name`,
    description: `${formId}-description`,
    text: `${formId}-text`,
  }

  return (
    <form
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (!blocked) props.onSubmit()
      }}
    >
      <div className={css.field}>
        <label className={css.label} htmlFor={ids.name}>{props.t('settings.nameLabel')}</label>
        <input
          id={ids.name}
          className={`${css.input} ${nameIssue !== null ? css.invalid : ''}`}
          value={props.draft.name}
          autoComplete="off"
          spellCheck={false}
          disabled={props.busy}
          onChange={(event) => props.onChange({ ...props.draft, name: event.target.value })}
        />
        {preview !== null ? <p className={css.preview}>{props.t('settings.namePreview', { slash: preview })}</p> : null}
        {nameIssue !== null
          ? <p className={css.error}>{formatCatalogIssue(props.locale, nameIssue)}</p>
          : <p className={css.hint}>{props.t('settings.nameHint')}</p>}
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor={ids.description}>{props.t('settings.descriptionLabel')}</label>
        <input
          id={ids.description}
          className={`${css.input} ${descriptionIssue !== null ? css.invalid : ''}`}
          value={props.draft.description}
          disabled={props.busy}
          onChange={(event) => props.onChange({ ...props.draft, description: event.target.value })}
        />
        {descriptionIssue !== null
          ? <p className={css.error}>{formatCatalogIssue(props.locale, descriptionIssue)}</p>
          : <p className={css.hint}>{props.t('settings.descriptionHint')}</p>}
      </div>
      <div className={css.field}>
        <label className={css.label} htmlFor={ids.text}>{props.t('settings.textLabel')}</label>
        <textarea
          id={ids.text}
          className={`${css.textarea} ${textIssue !== null ? css.invalid : ''}`}
          value={props.draft.steerText}
          placeholder={props.t('settings.textPlaceholder')}
          disabled={props.busy}
          onChange={(event) => props.onChange({ ...props.draft, steerText: event.target.value })}
        />
        {textIssue !== null
          ? <p className={css.error}>{formatCatalogIssue(props.locale, textIssue)}</p>
          : <p className={css.hint}>{props.t('settings.textHint')}</p>}
      </div>
      <div className={css.actions}>
        <button type="submit" className={`${css.btn} ${css.primary}`} disabled={blocked}>
          {props.busy ? props.submittingLabel : props.submitLabel}
        </button>
        {props.onCancel !== undefined ? (
          <button type="button" className={css.btn} disabled={props.busy} onClick={props.onCancel}>
            {props.t('settings.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  )
}
