import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { GitClient } from '../api.ts'
import { fail } from '../../shared/errors.ts'
import type { GitFail } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './TerminalView.module.css'

type TermEvent =
  | { type: 'hello'; cwd: string; shell: string; cols: number; rows: number }
  | { type: 'out'; text: string }
  | { type: 'exit'; code: number | null }

export function TerminalView({
  client, workspaceId, t,
}: {
  client: GitClient
  workspaceId?: string
  t: Translate
}) {
  const [cwd, setCwd] = useState('')
  const [status, setStatus] = useState<'idle' | 'live' | 'dead'>('idle')
  const [error, setError] = useState<GitFail | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const writeQueue = useRef<string[]>([])
  const flushing = useRef(false)

  useEffect(() => {
    if (workspaceId === undefined || hostRef.current === null) {
      sourceRef.current?.close()
      sourceRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
      setStatus('idle')
      setCwd('')
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      scrollback: 5000,
      allowProposedApi: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const size = () => ({
      cols: Math.max(10, term.cols),
      rows: Math.max(4, term.rows),
    })

    const connect = (): void => {
      sourceRef.current?.close()
      const { cols, rows } = size()
      const source = new EventSource(
        `/git/term/stream?workspaceId=${encodeURIComponent(workspaceId)}&cols=${cols}&rows=${rows}`,
      )
      sourceRef.current = source
      setStatus('idle')
      setError(null)
      source.onmessage = (event) => {
        let payload: TermEvent
        try {
          payload = JSON.parse(event.data) as TermEvent
        } catch {
          return
        }
        if (payload.type === 'hello') {
          setCwd(payload.cwd)
          setStatus('live')
          return
        }
        if (payload.type === 'out') {
          setStatus('live')
          term.write(payload.text)
          return
        }
        if (payload.type === 'exit') {
          setStatus('dead')
          term.write(`\r\n\x1b[31m${t('term.exited', { code: payload.code ?? '?' })}\x1b[0m\r\n`)
        }
      }
      source.onerror = () => {
        if (source.readyState !== EventSource.CLOSED) return
        setStatus('dead')
        setError(fail('TERM_FAILED'))
      }
    }

    const flushWrites = async (): Promise<void> => {
      if (flushing.current) return
      flushing.current = true
      while (writeQueue.current.length > 0) {
        const data = writeQueue.current.splice(0, 64).join('')
        const result = await client.writeTerm(workspaceId, data)
        if (!result.ok) {
          setError(result)
          break
        }
      }
      flushing.current = false
    }

    connect()
    const onData = term.onData((data) => {
      writeQueue.current.push(data)
      void flushWrites()
    })
    const onResize = term.onResize(({ cols, rows }) => {
      void client.resizeTerm(workspaceId, cols, rows)
    })
    const observer = new ResizeObserver(() => {
      try { fit.fit() } catch { /* host not ready */ }
    })
    observer.observe(hostRef.current)
    term.focus()

    return () => {
      observer.disconnect()
      onData.dispose()
      onResize.dispose()
      sourceRef.current?.close()
      sourceRef.current = null
      writeQueue.current = []
      term.dispose()
      if (termRef.current === term) termRef.current = null
      fitRef.current = null
    }
  }, [client, t, workspaceId])

  const restart = async (): Promise<void> => {
    if (workspaceId === undefined) return
    setError(null)
    termRef.current?.reset()
    const cols = termRef.current?.cols ?? 80
    const rows = termRef.current?.rows ?? 24
    const result = await client.restartTerm(workspaceId, cols, rows)
    if (!result.ok) {
      setError(result)
      return
    }
    setCwd(result.value.cwd)
    setStatus('live')
    termRef.current?.focus()
  }

  if (workspaceId === undefined) {
    return (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('term.noWorkspace')}</p>
        <p className={css.emptyHint}>{t('term.noWorkspaceHint')}</p>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.meta}>
        <span className={css.cwd} title={cwd}>{cwd === '' ? t('term.connecting') : cwd}</span>
        <IconButton
          label={t('term.interrupt')}
          disabled={status !== 'live'}
          onClick={() => { void client.interruptTerm(workspaceId) }}
        >
          <span className={css.ctrl}>^C</span>
        </IconButton>
        <IconButton label={t('term.retry')} onClick={() => { void restart() }}>
          <IconRefresh />
        </IconButton>
      </div>
      {error !== null ? (
        <div className={css.banner} role="alert">
          <div>{error.messageZh}</div>
          <div>{error.hintZh}</div>
        </div>
      ) : null}
      {status === 'dead' ? (
        <div className={css.banner} role="status">
          <div>{t('term.deadHint')}</div>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={css.term}
        onClick={() => { termRef.current?.focus() }}
      />
    </div>
  )
}
