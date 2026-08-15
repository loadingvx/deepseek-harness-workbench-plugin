import { useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import {
  classifyTermAssistInput,
  clipAssistInput,
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
import { IconButton } from './IconButton.tsx'
import { IconCheck, IconClose, IconSend, IconSparkle, IconStop, IconTune } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './TermAssistBar.module.css'

const TEMPLATE_KEY = 'dsh-workbench-term-assist-template'

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

function visiblePreview(raw: string): string {
  return previewAssistText(raw).replace(/^(ASK|NOTE|说明)\s*[:：]\s*/i, '')
}

type Phase = 'idle' | 'run' | 'ask' | 'confirm' | 'error'

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
  const [pending, setPending] = useState<{ command: string; explain: string } | null>(null)
  const [customTemplate, setCustomTemplate] = useState<string | null>(readCustomTemplate)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState('')
  const localeDefault = t('term.ai.templateDefault')
  const template = customTemplate ?? localeDefault
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const generating = phase === 'ask' || phase === 'run'

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
    setPending(null)
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

  const runCommand = async (command: string, fromModel: boolean, explain = '', userText = ''): Promise<void> => {
    const note = fromModel ? resolveAssistExplain(explain, userText) : ''
    if (fromModel && looksDestructiveCommand(command)) {
      setPending({ command, explain: note })
      setPreview(command)
      setPhase('confirm')
      busyRef.current = false
      return
    }
    setPhase('run')
    setPreview(note === '' ? command : `# ${note}\n${command}`)
    await sendBytes(termAssistRunPayload(command, note, shell))
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
    if (classifyTermAssistInput(text) === 'run') {
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
      const parsed = parseAssistOutput(result.value.message)
      if (parsed.kind === 'ask') {
        setPreview('')
        void sendBytes(termAssistCommentPayload(parsed.note, shell)).then(() => {
          resetBusy()
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

  const statusText = !live
    ? t('term.ai.dead')
    : phase === 'ask' && preview === ''
      ? t('term.ai.thinking')
      : phase === 'ask'
        ? t('term.ai.ask')
        : phase === 'run'
          ? t('term.ai.run')
          : phase === 'confirm'
            ? t('term.ai.confirmTitle')
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
          label={customTemplate === null ? t('term.ai.template') : t('term.ai.templateCustom')}
          active={customTemplate !== null}
          onClick={() => {
            setTemplateDraft(template)
            setTemplateOpen(true)
          }}
        >
          <IconTune />
        </IconButton>
        <IconButton dense label={t('term.ai.close')} onClick={onClose}>
          <IconClose />
        </IconButton>
      </div>

      {preview !== '' && phase !== 'confirm' ? (
        <code className={css.stream} data-live={generating || undefined}>{preview}</code>
      ) : null}

      {phase === 'confirm' && pending !== null ? (
        <div className={css.confirm} role="alertdialog" aria-labelledby="term-ai-confirm-title">
          <p id="term-ai-confirm-title">{t('term.ai.confirmTitle')}</p>
          <div className={css.confirmRow}>
            <code>{pending.explain === '' ? pending.command : `# ${pending.explain}\n${pending.command}`}</code>
            <span className={css.grow} />
            <IconButton
              dense
              label={t('term.ai.confirmCancel')}
              onClick={() => {
                setPending(null)
                setPreview('')
                setPhase('idle')
                inputRef.current?.focus()
              }}
            >
              <IconClose />
            </IconButton>
            <IconButton
              dense
              label={t('term.ai.confirmOk')}
              onClick={() => {
                const next = pending
                setPending(null)
                void sendBytes(termAssistRunPayload(next.command, next.explain, shell)).then(() => { inputRef.current?.focus() })
              }}
            >
              <IconCheck />
            </IconButton>
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <div className={css.fail} role="alert">
          <div>{error.messageZh}</div>
          {error.hintZh !== '' ? <div>{error.hintZh}</div> : null}
        </div>
      ) : null}

      {templateOpen ? (
        <div
          className={css.dialogMask}
          onClick={() => { setTemplateOpen(false) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setTemplateOpen(false)
          }}
        >
          <div
            className={css.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="term-ai-template-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="term-ai-template-title">{t('term.ai.templateTitle')}</h2>
            <p>{t('term.ai.templateHint')}</p>
            <label className={css.field}>
              <span>{t('term.ai.templateTitle')}</span>
              <textarea
                className={css.templateInput}
                value={templateDraft}
                autoFocus
                onChange={(event) => { setTemplateDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setTemplateOpen(false)
                }}
              />
            </label>
            <div className={css.dialogRow}>
              <button
                type="button"
                className={css.textBtn}
                onClick={() => { setTemplateDraft(localeDefault) }}
              >
                {t('term.ai.templateReset')}
              </button>
              <span className={css.grow} />
              <button type="button" className={css.textBtn} onClick={() => { setTemplateOpen(false) }}>
                {t('term.ai.templateCancel')}
              </button>
              <button
                type="button"
                className={css.textBtn}
                data-primary
                onClick={() => {
                  setCustomTemplate(writeCustomTemplate(templateDraft, localeDefault))
                  setTemplateOpen(false)
                }}
              >
                {t('term.ai.templateSave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
