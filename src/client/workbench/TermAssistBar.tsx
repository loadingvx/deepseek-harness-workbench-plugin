import { useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import {
  classifyTermAssistInput,
  clipAssistInput,
  destructiveAssistNote,
  looksDestructiveCommand,
  parseAssistOutput,
  previewAssistText,
  resolveAssistExplain,
  termAssistCommentPayload,
  termAssistRunPayload,
} from '../../shared/term-assist.ts'
import {
  isDefaultTermAssistTemplate,
  resolveTermAssistTemplate,
} from '../../shared/term-assist-prompt.ts'
import {
  cloneTermAssistPrefs,
  DEFAULT_TERM_ASSIST_PREFS,
  isDefaultTermAssistPrefs,
  parseStoredTermAssistPrefs,
  resolveTermAssistPrefs,
  type TermAssistPrefs,
} from '../../shared/term-assist-prefs.ts'
import {
  createBlacklistRule,
  MAX_BLACKLIST_RULES,
  type BlacklistKind,
  type BlacklistRule,
} from '../../shared/term-assist-blacklist.ts'
import { IconButton } from './IconButton.tsx'
import { IconClose, IconSend, IconSparkle, IconStop, IconTune } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './TermAssistBar.module.css'

const TEMPLATE_KEY = 'dsh-workbench-term-assist-template'
const PREFS_KEY = 'dsh-workbench-term-assist-prefs'

function readCustomTemplate(): string | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    if (raw === null || raw.trim() === '' || isDefaultTermAssistTemplate(raw)) return null
    return resolveTermAssistTemplate(raw)
  } catch {
    return null
  }
}

function writeCustomTemplate(value: string, fallback: string): string | null {
  const next = resolveTermAssistTemplate(value, fallback)
  try {
    if (isDefaultTermAssistTemplate(next)) {
      localStorage.removeItem(TEMPLATE_KEY)
      return null
    }
    localStorage.setItem(TEMPLATE_KEY, next)
    return next
  } catch {
    return isDefaultTermAssistTemplate(next) ? null : next
  }
}

function readPrefs(): TermAssistPrefs {
  try {
    return parseStoredTermAssistPrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS)
  }
}

function writePrefs(prefs: TermAssistPrefs): TermAssistPrefs {
  const next = resolveTermAssistPrefs(prefs)
  try {
    if (isDefaultTermAssistPrefs(next)) localStorage.removeItem(PREFS_KEY)
    else localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode: keep in-memory prefs */
  }
  return next
}

function visiblePreview(raw: string): string {
  return previewAssistText(raw).replace(/^(ASK|NOTE|说明)\s*[:：]\s*/i, '')
}

type Phase = 'idle' | 'run' | 'ask' | 'error'

export function TermAssistBar({
  client,
  workspaceId,
  termId,
  cwd,
  shell,
  live,
  t,
  onClose,
  readTranscript,
  inputRef,
}: {
  client: GitClient
  workspaceId?: string
  termId?: string
  cwd: string
  shell: string
  live: boolean
  t: Translate
  onClose: () => void
  readTranscript: () => string
  inputRef: { current: HTMLTextAreaElement | null }
}) {
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<GitFail | null>(null)
  const [customTemplate, setCustomTemplate] = useState<string | null>(readCustomTemplate)
  const [prefs, setPrefs] = useState<TermAssistPrefs>(readPrefs)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState('')
  const [prefsDraft, setPrefsDraft] = useState<TermAssistPrefs>(readPrefs)
  const [settingsError, setSettingsError] = useState('')
  const localeDefault = t('term.ai.templateDefault')
  const template = customTemplate ?? localeDefault
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const generating = phase === 'ask' || phase === 'run'
  const settingsCustom = customTemplate !== null || !isDefaultTermAssistPrefs(prefs)

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  useEffect(() => {
    const el = inputRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 72)}px`
  }, [draft, inputRef])

  const resetBusy = (): void => {
    busyRef.current = false
    abortRef.current = null
  }

  const fail = (messageZh: string, hintZh = ''): void => {
    setError({ ok: false, code: 'EMPTY_MESSAGE', messageZh, hintZh })
    setPhase('error')
  }

  const sendBytes = async (payload: string): Promise<boolean> => {
    if (workspaceId === undefined) return false
    const result = await client.writeTerm(workspaceId, payload, termId)
    if (!result.ok) {
      setError(result)
      setPhase('error')
      return false
    }
    setError(null)
    setDraft('')
    setPreview('')
    setPhase('idle')
    return true
  }

  const stop = (): void => {
    abortRef.current?.abort()
    resetBusy()
    setPhase('idle')
    setPreview('')
  }

  const refuseDestructive = async (command: string): Promise<void> => {
    setPreview('')
    const ok = await sendBytes(termAssistCommentPayload(destructiveAssistNote(command), shell, prefs))
    resetBusy()
    if (ok) fail(t('term.ai.refused'), t('term.ai.refusedHint'))
    inputRef.current?.focus()
  }

  const runCommand = async (command: string, fromModel: boolean, explain = '', userText = ''): Promise<void> => {
    if (looksDestructiveCommand(command, prefs)) {
      await refuseDestructive(command)
      return
    }
    const note = fromModel ? resolveAssistExplain(explain, userText) : ''
    setPhase('run')
    setPreview(note === '' ? command : `# ${note}\n${command}`)
    await sendBytes(termAssistRunPayload(command, note, shell, prefs))
    resetBusy()
    inputRef.current?.focus()
  }

  const submit = (): void => {
    if (busyRef.current || generating) return
    if (!live) {
      fail(t('term.ai.dead'))
      return
    }
    const text = clipAssistInput(draft)
    if (text === '') {
      fail(t('term.ai.empty'))
      return
    }
    if (workspaceId === undefined) return
    setError(null)
    const direct = prefs.directRunKnownCommands && classifyTermAssistInput(text) === 'run'
    if (direct) {
      busyRef.current = true
      void runCommand(text, false)
      return
    }
    busyRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('ask')
    setPreview('')
    void client.assistTerm(workspaceId, text, {
      cwd,
      transcript: readTranscript(),
      template,
      prefs,
      signal: controller.signal,
      onDelta: (chunk) => {
        if (controller.signal.aborted) return
        setPreview(visiblePreview(chunk))
      },
    }).then((result) => {
      if (controller.signal.aborted) {
        resetBusy()
        return
      }
      if (!result.ok) {
        setError(result.code === 'BAD_REQUEST' ? {
          ok: false,
          code: result.code,
          messageZh: t('term.ai.needRestart'),
          hintZh: t('term.ai.needRestartHint'),
        } : result)
        setPhase('error')
        resetBusy()
        return
      }
      const parsed = parseAssistOutput(result.value.message, prefs)
      if (parsed.kind === 'ask') {
        setPreview('')
        void sendBytes(termAssistCommentPayload(parsed.note, shell, prefs)).then((ok) => {
          resetBusy()
          if (ok && parsed.note.startsWith('已拒绝执行')) {
            fail(t('term.ai.refused'), t('term.ai.refusedHint'))
          }
          inputRef.current?.focus()
        })
        return
      }
      if (parsed.kind === 'empty') {
        fail(t('term.ai.empty'), t('term.ai.hint'))
        resetBusy()
        return
      }
      void runCommand(parsed.command, true, parsed.explain, text)
    })
  }

  const openSettings = (): void => {
    setTemplateDraft(template)
    setPrefsDraft(cloneTermAssistPrefs(prefs))
    setSettingsError('')
    setSettingsOpen(true)
  }

  const closeSettings = (): void => {
    setSettingsOpen(false)
    setSettingsError('')
  }

  const saveSettings = (): void => {
    const empty = prefsDraft.blacklist.find(rule => rule.enabled && rule.pattern.trim() === '')
    if (empty !== undefined) {
      setSettingsError(t('term.ai.pref.blacklistEmpty'))
      return
    }
    setCustomTemplate(writeCustomTemplate(templateDraft, localeDefault))
    setPrefs(writePrefs(prefsDraft))
    setSettingsError('')
    setSettingsOpen(false)
  }

  const resetSettingsDraft = (): void => {
    setTemplateDraft(localeDefault)
    setPrefsDraft(cloneTermAssistPrefs(DEFAULT_TERM_ASSIST_PREFS))
    setSettingsError('')
  }

  const patchPrefs = (patch: Partial<TermAssistPrefs>): void => {
    setSettingsError('')
    setPrefsDraft(current => ({
      ...current,
      ...patch,
      blacklist: patch.blacklist ?? current.blacklist,
    }))
  }

  const patchRule = (id: string, patch: Partial<BlacklistRule>): void => {
    setSettingsError('')
    setPrefsDraft(current => ({
      ...current,
      blacklist: current.blacklist.map(rule => rule.id === id ? { ...rule, ...patch } : rule),
    }))
  }

  const addRule = (kind: BlacklistKind): void => {
    setSettingsError('')
    setPrefsDraft(current => {
      if (current.blacklist.length >= MAX_BLACKLIST_RULES) return current
      return { ...current, blacklist: [...current.blacklist, createBlacklistRule(kind)] }
    })
  }

  const removeRule = (id: string): void => {
    setSettingsError('')
    setPrefsDraft(current => ({
      ...current,
      blacklist: current.blacklist.filter(rule => rule.id !== id),
    }))
  }

  const statusText = !live
    ? t('term.ai.dead')
    : phase === 'ask' && preview === ''
      ? t('term.ai.thinking')
      : phase === 'ask'
        ? t('term.ai.ask')
        : phase === 'run'
          ? t('term.ai.run')
          : phase === 'error'
            ? t('term.ai.failed')
            : t('term.ai.title')

  return (
    <div className={css.root} data-busy={generating || undefined} data-phase={phase}>
      <span className={css.sr} role="status">{statusText}</span>
      <div className={css.row}>
        <span className={css.mark} data-spin={generating || undefined} aria-hidden>
          <IconSparkle size={14} />
        </span>
        <textarea
          ref={(el) => { inputRef.current = el }}
          className={css.input}
          rows={1}
          value={draft}
          disabled={!live && draft === ''}
          readOnly={generating}
          placeholder={live ? t('term.ai.placeholder') : t('term.ai.dead')}
          aria-label={t('term.ai.title')}
          title={t('term.ai.shortcut')}
          onChange={(event) => {
            setDraft(event.target.value)
            if (phase === 'error') {
              setPhase('idle')
              setError(null)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              if (generating) stop()
              else onClose()
              return
            }
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        {generating ? (
          <IconButton dense label={t('term.ai.stop')} onClick={stop}>
            <IconStop />
          </IconButton>
        ) : (
          <IconButton
            dense
            label={t('term.ai.send')}
            disabled={!live || clipAssistInput(draft) === ''}
            onClick={submit}
          >
            <IconSend />
          </IconButton>
        )}
        <IconButton
          dense
          label={settingsCustom ? t('term.ai.settingsCustom') : t('term.ai.settings')}
          active={settingsCustom}
          onClick={openSettings}
        >
          <IconTune />
        </IconButton>
        <IconButton dense label={t('term.ai.close')} onClick={onClose}>
          <IconClose />
        </IconButton>
      </div>

      {preview !== '' ? (
        <code className={css.stream} data-live={generating || undefined}>{preview}</code>
      ) : null}

      {error !== null ? (
        <div className={css.fail} role="alert">
          <div>{error.messageZh}</div>
          {error.hintZh !== '' ? <div>{error.hintZh}</div> : null}
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className={css.dialogMask}
          onClick={closeSettings}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeSettings()
          }}
        >
          <div
            className={css.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="term-ai-settings-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="term-ai-settings-title">{t('term.ai.settingsTitle')}</h2>
            <p>{t('term.ai.settingsHint')}</p>

            <div className={css.settingsBody}>
              <section className={css.section} aria-labelledby="term-ai-pref-display">
                <h3 id="term-ai-pref-display">{t('term.ai.pref.display')}</h3>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={prefsDraft.showSeparator}
                    onChange={(event) => { patchPrefs({ showSeparator: event.target.checked }) }}
                  />
                  <span>
                    <span className={css.checkTitle}>{t('term.ai.pref.separator')}</span>
                    <span className={css.checkHint}>{t('term.ai.pref.separatorHint')}</span>
                  </span>
                </label>
                <label className={css.inlineField}>
                  <span>{t('term.ai.pref.separatorText')}</span>
                  <input
                    className={css.sepInput}
                    value={prefsDraft.separatorText}
                    disabled={!prefsDraft.showSeparator}
                    maxLength={80}
                    spellCheck={false}
                    aria-label={t('term.ai.pref.separatorText')}
                    onChange={(event) => { patchPrefs({ separatorText: event.target.value }) }}
                  />
                </label>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={prefsDraft.showExplain}
                    onChange={(event) => { patchPrefs({ showExplain: event.target.checked }) }}
                  />
                  <span>
                    <span className={css.checkTitle}>{t('term.ai.pref.explain')}</span>
                    <span className={css.checkHint}>{t('term.ai.pref.explainHint')}</span>
                  </span>
                </label>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={prefsDraft.directRunKnownCommands}
                    onChange={(event) => { patchPrefs({ directRunKnownCommands: event.target.checked }) }}
                  />
                  <span>
                    <span className={css.checkTitle}>{t('term.ai.pref.directRun')}</span>
                    <span className={css.checkHint}>{t('term.ai.pref.directRunHint')}</span>
                  </span>
                </label>
              </section>

              <section className={css.section} aria-labelledby="term-ai-pref-safety">
                <h3 id="term-ai-pref-safety">{t('term.ai.pref.safety')}</h3>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={prefsDraft.blockDestructive}
                    onChange={(event) => { patchPrefs({ blockDestructive: event.target.checked }) }}
                  />
                  <span>
                    <span className={css.checkTitle}>{t('term.ai.pref.block')}</span>
                    <span className={css.checkHint}>{t('term.ai.pref.blockHint')}</span>
                  </span>
                </label>
                {!prefsDraft.blockDestructive ? (
                  <p className={css.warn} role="status">{t('term.ai.pref.blockOffWarn')}</p>
                ) : prefsDraft.blacklist.length === 0 ? (
                  <p className={css.warn} role="status">{t('term.ai.pref.blacklistNone')}</p>
                ) : null}
                {settingsError !== '' ? (
                  <p className={css.warn} role="alert">{settingsError}</p>
                ) : null}

                <h4 className={css.subhead}>{t('term.ai.pref.rmList')}</h4>
                <p className={css.checkHint}>{t('term.ai.pref.rmHint')}</p>
                <div className={css.rules} data-off={!prefsDraft.blockDestructive || undefined}>
                  {prefsDraft.blacklist.filter(rule => rule.kind === 'rm').map(rule => (
                    <div key={rule.id} className={css.ruleRow}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={!prefsDraft.blockDestructive}
                        aria-label={t('term.ai.pref.ruleOn')}
                        onChange={(event) => { patchRule(rule.id, { enabled: event.target.checked }) }}
                      />
                      <input
                        className={css.sepInput}
                        value={rule.pattern}
                        disabled={!prefsDraft.blockDestructive}
                        spellCheck={false}
                        maxLength={80}
                        placeholder={t('term.ai.pref.rmPlaceholder')}
                        aria-label={t('term.ai.pref.rmList')}
                        onChange={(event) => { patchRule(rule.id, { pattern: event.target.value }) }}
                      />
                      <button
                        type="button"
                        className={css.textBtn}
                        disabled={!prefsDraft.blockDestructive}
                        onClick={() => { removeRule(rule.id) }}
                      >
                        {t('term.ai.pref.removeRule')}
                      </button>
                    </div>
                  ))}
                  {prefsDraft.blacklist.some(rule => rule.kind === 'rm') ? null : (
                    <p className={css.checkHint}>{t('term.ai.pref.rmEmpty')}</p>
                  )}
                  <button
                    type="button"
                    className={css.textBtn}
                    disabled={!prefsDraft.blockDestructive || prefsDraft.blacklist.length >= MAX_BLACKLIST_RULES}
                    onClick={() => { addRule('rm') }}
                  >
                    {t('term.ai.pref.addRm')}
                  </button>
                </div>

                <h4 className={css.subhead}>{t('term.ai.pref.otherList')}</h4>
                <p className={css.checkHint}>{t('term.ai.pref.otherHint')}</p>
                <div className={css.rules} data-off={!prefsDraft.blockDestructive || undefined}>
                  {prefsDraft.blacklist.filter(rule => rule.kind === 'other').map(rule => (
                    <div key={rule.id} className={css.ruleRow}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={!prefsDraft.blockDestructive}
                        aria-label={t('term.ai.pref.ruleOn')}
                        onChange={(event) => { patchRule(rule.id, { enabled: event.target.checked }) }}
                      />
                      <input
                        className={css.sepInput}
                        value={rule.pattern}
                        disabled={!prefsDraft.blockDestructive}
                        spellCheck={false}
                        maxLength={80}
                        placeholder={t('term.ai.pref.otherPlaceholder')}
                        aria-label={t('term.ai.pref.otherList')}
                        onChange={(event) => { patchRule(rule.id, { pattern: event.target.value }) }}
                      />
                      <button
                        type="button"
                        className={css.textBtn}
                        disabled={!prefsDraft.blockDestructive}
                        onClick={() => { removeRule(rule.id) }}
                      >
                        {t('term.ai.pref.removeRule')}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={css.textBtn}
                    disabled={!prefsDraft.blockDestructive || prefsDraft.blacklist.length >= MAX_BLACKLIST_RULES}
                    onClick={() => { addRule('other') }}
                  >
                    {t('term.ai.pref.addOther')}
                  </button>
                </div>
                {prefsDraft.blacklist.length >= MAX_BLACKLIST_RULES ? (
                  <p className={css.checkHint}>{t('term.ai.pref.blacklistMax', { max: MAX_BLACKLIST_RULES })}</p>
                ) : null}
              </section>

              <label className={css.field}>
                <span>{t('term.ai.templateTitle')}</span>
                <textarea
                  className={css.templateInput}
                  value={templateDraft}
                  onChange={(event) => { setTemplateDraft(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeSettings()
                  }}
                />
              </label>
            </div>

            <div className={css.dialogRow}>
              <button type="button" className={css.textBtn} onClick={resetSettingsDraft}>
                {t('term.ai.templateReset')}
              </button>
              <span className={css.grow} />
              <button type="button" className={css.textBtn} onClick={closeSettings}>
                {t('term.ai.templateCancel')}
              </button>
              <button type="button" className={css.textBtn} data-primary onClick={saveSettings}>
                {t('term.ai.templateSave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
