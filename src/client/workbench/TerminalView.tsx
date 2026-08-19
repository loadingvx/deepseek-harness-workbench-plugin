import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { GitClient } from '../api.ts'
import { fail } from '../../shared/errors.ts'
import { isTermAssistHotkey, isTermNewTabHotkey } from '../../shared/term-assist.ts'
import type { GitFail } from '../../shared/types.ts'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu.tsx'
import { IconButton } from './IconButton.tsx'
import { IconChat, IconCopy, IconRefresh, IconSparkle } from './icons.tsx'
import { TermAssistBar } from './TermAssistBar.tsx'
import { isCleanTermExit, type TermCleanExitAction } from './term-session.ts'
import type { Translate } from './types.ts'
import css from './TerminalView.module.css'

type TermEvent =
  | { type: 'hello'; cwd: string; shell: string; cols: number; rows: number }
  | { type: 'out'; text: string }
  | { type: 'exit'; code: number | null }

export function TerminalView({
  client, workspaceId, termId, injectComment, t, aiOpen = false, onAiModeChange, chromeHost, onCleanExit, onAddTermToChat,
}: {
  client: GitClient
  workspaceId?: string
  termId?: string
  injectComment?: string
  t: Translate
  aiOpen?: boolean
  onAiModeChange?: (open: boolean) => void
  /** Title-bar slot. Buttons render there so the terminal has no extra cwd strip. */
  chromeHost?: HTMLElement | null
  /** Ctrl+D / `exit` 0: close this tab or hide the panel; do not paint an error. */
  onCleanExit?: () => TermCleanExitAction
  /** 终端选中内容 / 最近输出 → 原生会话胶囊。 */
  onAddTermToChat?: (text: string) => boolean
}) {
  const [cwd, setCwd] = useState('')
  const [shell, setShell] = useState('')
  const [status, setStatus] = useState<'idle' | 'live' | 'dead'>('idle')
  const [error, setError] = useState<GitFail | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const writeQueue = useRef<string[]>([])
  const flushing = useRef(false)
  const assistInputRef = useRef<HTMLTextAreaElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selBtnRef = useRef<HTMLButtonElement | null>(null)
  const placeSelRef = useRef<() => void>(() => {})
  const aiOpenRef = useRef(aiOpen)
  const onCleanExitRef = useRef(onCleanExit)
  const onAddTermToChatRef = useRef(onAddTermToChat)
  onCleanExitRef.current = onCleanExit
  onAddTermToChatRef.current = onAddTermToChat
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<{ text: string; startRow: number; endRow: number; startCol: number; endCol: number } | null>(null)
  const [copiedFlash, setCopiedFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((label: string): void => {
    setCopiedFlash(label)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setCopiedFlash(null) }, 1600)
  }, [])

  const copyText = useCallback(async (text: string, okLabel: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try { document.execCommand('copy') } catch { /* clipboard blocked */ }
      document.body.removeChild(area)
    }
    flash(okLabel)
  }, [flash])

  const setAiOpen = (open: boolean): void => {
    onAiModeChange?.(open)
  }

  useEffect(() => {
    if (workspaceId === undefined || hostRef.current === null) {
      sourceRef.current?.close()
      sourceRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
      setStatus('idle')
      setCwd('')
      setShell('')
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
      // Right-click selects the word under the cursor so the context menu
      // can copy / send it to chat immediately.
      rightClickSelectsWord: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      // Never let xterm type these into the PTY: Alt+J opens a new terminal tab,
      // Alt+I toggles the AI assist bar. Both are handled on window.
      if (isTermAssistHotkey(event) || isTermNewTabHotkey(event)) return false
      return true
    })
    termRef.current = term
    fitRef.current = fit

    const applyFit = (): boolean => {
      try {
        fit.fit()
        return term.cols >= 10 && term.rows >= 4
      } catch {
        return false
      }
    }

    const size = () => ({
      cols: Math.max(10, term.cols),
      rows: Math.max(4, term.rows),
    })

    const connect = (): void => {
      sourceRef.current?.close()
      const { cols, rows } = size()
      const source = new EventSource(
        `/git/term/stream?workspaceId=${encodeURIComponent(workspaceId)}&termId=${encodeURIComponent(termId ?? 'main')}&cols=${cols}&rows=${rows}`,
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
          setShell(payload.shell)
          setStatus('live')
          return
        }
        if (payload.type === 'out') {
          setStatus('live')
          term.write(payload.text)
          return
        }
        if (payload.type === 'exit') {
          if (isCleanTermExit(payload.code)) {
            const action = onCleanExitRef.current?.() ?? 'hide'
            if (action === 'close') return
            term.reset()
            source.close()
            if (sourceRef.current === source) sourceRef.current = null
            setError(null)
            setStatus('idle')
            connect()
            return
          }
          setStatus('dead')
          term.write(`\r\n\x1b[31m${t('term.exited', { code: payload.code ?? '?' })}\x1b[0m\r\n`)
        }
      }
      source.onerror = () => {
        if (source.readyState !== EventSource.CLOSED) return
        if (sourceRef.current !== source) return
        setStatus('dead')
        setError(fail('TERM_FAILED'))
      }
    }

    const flushWrites = async (): Promise<void> => {
      if (flushing.current) return
      flushing.current = true
      while (writeQueue.current.length > 0) {
        const data = writeQueue.current.splice(0, 64).join('')
        const result = await client.writeTerm(workspaceId, data, termId)
        if (!result.ok) {
          setError(result)
          break
        }
      }
      flushing.current = false
    }

    const onData = term.onData((data) => {
      writeQueue.current.push(data)
      void flushWrites()
    })
    const onResize = term.onResize(({ cols, rows }) => {
      void client.resizeTerm(workspaceId, cols, rows, termId)
    })
    const onSelChange = term.onSelectionChange(() => {
      const text = term.getSelection()
      const pos = term.getSelectionPosition()
      if (text === '' || pos === undefined) {
        setSelection(null)
        return
      }
      setSelection({
        text,
        startRow: pos.start.y,
        endRow: pos.end.y,
        startCol: pos.start.x,
        endCol: pos.end.x,
      })
      placeSelRef.current()
    })
    const onScroll = term.onScroll(() => { placeSelRef.current() })
    const onRender = term.onRender(() => { placeSelRef.current() })
    const host = hostRef.current
    const observer = new ResizeObserver(() => { applyFit() })
    observer.observe(host)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyFit()
        if (sourceRef.current === null) connect()
        term.focus()
      })
    })

    return () => {
      observer.disconnect()
      onData.dispose()
      onResize.dispose()
      onSelChange.dispose()
      onScroll.dispose()
      onRender.dispose()
      sourceRef.current?.close()
      sourceRef.current = null
      writeQueue.current = []
      term.dispose()
      if (termRef.current === term) termRef.current = null
      fitRef.current = null
    }
  }, [client, t, termId, workspaceId])

  useEffect(() => {
    if (workspaceId === undefined || status !== 'live') return
    const text = injectComment?.trim()
    if (text === undefined || text === '') return
    const key = `dsh-workbench-plugin:term-hint:${text}`
    try {
      if (window.sessionStorage.getItem(key) === '1') return
    } catch { /* still try once */ }
    void client.writeTerm(workspaceId, text, termId).then((result) => {
      if (!result.ok) return
      try {
        window.sessionStorage.setItem(key, '1')
      } catch { /* private mode */ }
    })
  }, [client, injectComment, status, termId, workspaceId])

  useEffect(() => {
    const prev = aiOpenRef.current
    aiOpenRef.current = aiOpen
    if (aiOpen && !prev) {
      window.requestAnimationFrame(() => { assistInputRef.current?.focus() })
    }
    if (!aiOpen && prev) termRef.current?.focus()
  }, [aiOpen])

  const readTranscript = (): string => {
    const term = termRef.current
    if (term === null) return ''
    const buffer = term.buffer.active
    const end = Math.min(buffer.length - 1, buffer.baseY + buffer.cursorY)
    const start = Math.max(0, end - 39)
    const lines: string[] = []
    for (let i = start; i <= end; i++) {
      const line = buffer.getLine(i)?.translateToString(true).replace(/\s+$/, '')
      if (line !== undefined && line !== '') lines.push(line)
    }
    return lines.join('\n')
  }

  const restart = async (): Promise<void> => {
    if (workspaceId === undefined) return
    setError(null)
    termRef.current?.reset()
    const cols = termRef.current?.cols ?? 80
    const rows = termRef.current?.rows ?? 24
    const result = await client.restartTerm(workspaceId, cols, rows, termId)
    if (!result.ok) {
      setError(result)
      return
    }
    setCwd(result.value.cwd)
    setStatus('live')
    termRef.current?.focus()
  }

  /**
   * Floating "添加到chat" button pinned to the bottom-left of the selection.
   * Measures the rendered row element so xterm's internal padding never matters.
   */
  const placeSelectionButton = useCallback((): void => {
    const btn = selBtnRef.current
    const term = termRef.current
    const root = rootRef.current
    if (btn === null || term === null || root === null || hostRef.current === null) return
    const screen = hostRef.current.querySelector('.xterm-screen')
    if (!(screen instanceof HTMLElement)) {
      btn.style.display = 'none'
      return
    }
    const pos = term.getSelectionPosition()
    if (pos === undefined) {
      btn.style.display = 'none'
      return
    }
    const cellW = screen.clientWidth / Math.max(1, term.cols)
    const rootRect = root.getBoundingClientRect()
    const viewportRow = pos.end.y - term.buffer.active.viewportY
    const leftCol = pos.start.y === pos.end.y ? pos.start.x : 1
    const rowsEl = screen.querySelector('.xterm-rows')
    const rowEl = rowsEl instanceof HTMLElement ? rowsEl.children[viewportRow] : undefined
    let left = 0
    let top = 0
    if (rowEl instanceof HTMLElement) {
      const rowRect = rowEl.getBoundingClientRect()
      left = rowRect.left - rootRect.left + (leftCol - 1) * cellW
      top = rowRect.bottom - rootRect.top
    } else {
      const screenRect = screen.getBoundingClientRect()
      const cellH = screen.clientHeight / Math.max(1, term.rows)
      left = screenRect.left - rootRect.left + (leftCol - 1) * cellW
      top = screenRect.top - rootRect.top + viewportRow * cellH + cellH
    }
    btn.style.display = 'flex'
    btn.style.left = `${Math.max(4, left)}px`
    btn.style.top = `${Math.max(4, top + 4)}px`
  }, [])
  placeSelRef.current = placeSelectionButton

  useEffect(() => {
    if (selection === null) return
    placeSelRef.current()
  }, [selection])

  useEffect(() => () => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
  }, [])

  /**
   * Read the selection straight off xterm (not the React state): clicking the
   * floating button may blur the terminal and clear the selection first, so
   * the state snapshot can already be null while xterm still holds the text.
   */
  const currentSelectionText = (): string => {
    const term = termRef.current
    if (term !== null && term.hasSelection()) {
      const live = term.getSelection()
      if (live !== '') return live
    }
    return selection?.text ?? ''
  }

  const addSelectionToChat = (): void => {
    const text = currentSelectionText()
    if (text === '') return
    const ok = onAddTermToChatRef.current?.(text)
    if (ok) flash(t('term.menu.addedToChat'))
    termRef.current?.clearSelection()
    setSelection(null)
  }

  const addOutputToChat = (): void => {
    const text = readTranscript()
    if (text === '') return
    const ok = onAddTermToChatRef.current?.(text)
    if (ok) flash(t('term.menu.addedToChat'))
  }

  const ctxItems: ContextMenuEntry[] = [
    {
      kind: 'item',
      id: 'copy-sel',
      icon: <IconCopy />,
      label: t('term.menu.copySel'),
      disabled: selection === null,
      onClick: () => { if (selection !== null) void copyText(selection.text, t('term.menu.copied')) },
    },
    {
      kind: 'item',
      id: 'sel-to-chat',
      icon: <IconChat />,
      label: t('term.menu.addSelToChat'),
      disabled: selection === null,
      onClick: addSelectionToChat,
    },
    { kind: 'sep' },
    {
      kind: 'item',
      id: 'copy-output',
      icon: <IconCopy />,
      label: t('term.menu.copyOutput'),
      onClick: () => {
        const text = readTranscript()
        if (text !== '') void copyText(text, t('term.menu.copied'))
      },
    },
    {
      kind: 'item',
      id: 'output-to-chat',
      icon: <IconChat />,
      label: t('term.menu.addOutputToChat'),
      onClick: addOutputToChat,
    },
    { kind: 'sep' },
    {
      kind: 'item',
      id: 'interrupt',
      icon: <span className={css.ctrl}>^C</span>,
      label: t('term.interrupt'),
      disabled: status !== 'live',
      onClick: () => { if (workspaceId !== undefined) void client.interruptTerm(workspaceId, termId) },
    },
    {
      kind: 'item',
      id: 'restart',
      icon: <IconRefresh />,
      label: t('term.retry'),
      onClick: () => { void restart() },
    },
  ]

  if (workspaceId === undefined) {
    return (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('term.noWorkspace')}</p>
        <p className={css.emptyHint}>{t('term.noWorkspaceHint')}</p>
      </div>
    )
  }

  const chrome = (
    <div className={css.chrome}>
      <IconButton
        label={aiOpen ? t('term.ai.close') : t('term.ai.open')}
        active={aiOpen}
        onClick={() => {
          const next = !aiOpen
          setAiOpen(next)
          if (next) window.requestAnimationFrame(() => { assistInputRef.current?.focus() })
          else termRef.current?.focus()
        }}
      >
        <IconSparkle />
      </IconButton>
      <IconButton
        label={t('term.interrupt')}
        disabled={status !== 'live'}
        onClick={() => { void client.interruptTerm(workspaceId, termId) }}
      >
        <span className={css.ctrl}>^C</span>
      </IconButton>
      <IconButton label={t('term.retry')} onClick={() => { void restart() }}>
        <IconRefresh />
      </IconButton>
    </div>
  )

  return (
    <div ref={rootRef} className={css.root} data-ai={aiOpen || undefined}>
      {chromeHost != null ? createPortal(chrome, chromeHost) : null}
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
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setCtxMenu({ x: event.clientX, y: event.clientY })
        }}
      />
      <button
        ref={selBtnRef}
        type="button"
        className={css.selChatBtn}
        style={{ display: 'none' }}
        title={t('term.menu.addSelToChat')}
        // Keep focus in xterm: stealing focus blurs the terminal and clears
        // the selection before click fires, which made the button dead.
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { addSelectionToChat() }}
      >
        <IconChat />
        <span>{t('term.menu.addToChat')}</span>
      </button>
      {ctxMenu !== null ? (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          ariaLabel={t('term.menu')}
          onClose={() => { setCtxMenu(null) }}
        />
      ) : null}
      {copiedFlash !== null ? (
        <div className={css.copyFlash} role="status">{copiedFlash}</div>
      ) : null}
      {aiOpen ? (
        <TermAssistBar
          client={client}
          workspaceId={workspaceId}
          termId={termId}
          cwd={cwd}
          shell={shell}
          live={status === 'live'}
          t={t}
          inputRef={assistInputRef}
          readTranscript={readTranscript}
          onClose={() => {
            setAiOpen(false)
            termRef.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}
