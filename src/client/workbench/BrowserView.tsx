import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BROWSER_MSG_SOURCE } from '../../shared/browser-msg.ts'
import { normalizeBrowserElSnapshot, type BrowserElSnapshot } from '../../shared/browser-el.ts'
import { browserViewSrc, isWorkbenchSelfUrl, normalizeBrowserUrl } from '../../shared/browser-url.ts'
import { IconButton } from './IconButton.tsx'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDevtools,
  IconInspect,
  IconRefresh,
} from './icons.tsx'
import {
  canBrowserBack,
  canBrowserForward,
  commitBrowserUrl,
  ensureBrowserTab,
  goBrowserHistory,
  patchBrowserTab,
  pushBrowserConsole,
  clearBrowserConsole,
  beginBrowserLoad,
  consumeBrowserProbe,
  readBrowserTab,
  setBrowserApp,
  setBrowserCss,
  setBrowserFiles,
  subscribeBrowserSession,
  upsertBrowserNetwork,
  type BrowserConsoleLine,
} from './browser-session.ts'
import type { Translate } from './types.ts'
import css from './BrowserView.module.css'

export function BrowserView({
  tabId,
  onTitle,
  onOpenDevtools,
  onPick,
  t,
}: {
  tabId: string
  onTitle: (title: string, url: string) => void
  onOpenDevtools: () => void
  onPick: (snapshot: BrowserElSnapshot) => boolean
  t: Translate
}) {
  const state = useSyncExternalStore(
    subscribeBrowserSession,
    () => readBrowserTab(tabId),
    () => readBrowserTab(tabId),
  )
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const inspectRef = useRef(state.inspect)
  inspectRef.current = state.inspect
  const evalWaitRef = useRef<{ nonce: number; timer: number } | null>(null)
  const seenEvalRef = useRef<number | null>(null)
  const src = state.committed === '' ? '' : browserViewSrc(state.committed)
  const showEmpty = state.committed === ''

  useEffect(() => {
    ensureBrowserTab(tabId)
  }, [tabId])

  useEffect(() => {
    if (flash === null) return
    const id = window.setTimeout(() => { setFlash(null) }, 4000)
    return () => { window.clearTimeout(id) }
  }, [flash])

  const postInspect = (on: boolean): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'inspect', on }, '*')
  }

  useEffect(() => {
    if (!state.inspect) {
      postInspect(false)
      return
    }
    postInspect(true)
    let n = 0
    const id = window.setInterval(() => {
      n += 1
      postInspect(true)
      if (n >= 12) window.clearInterval(id)
    }, 250)
    return () => { window.clearInterval(id) }
  }, [state.inspect, src])

  useEffect(() => {
    const req = state.evalRequest
    if (req === null) return
    if (seenEvalRef.current === req.nonce) return
    seenEvalRef.current = req.nonce
    patchBrowserTab(tabId, { evalRequest: null })
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) {
      pushBrowserConsole(tabId, 'error', t('browser.info.consoleEvalNoFrame'), 'result')
      return
    }
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'eval', id: req.nonce, code: req.code }, '*')
    if (evalWaitRef.current !== null) window.clearTimeout(evalWaitRef.current.timer)
    const timer = window.setTimeout(() => {
      if (evalWaitRef.current?.nonce !== req.nonce) return
      evalWaitRef.current = null
      pushBrowserConsole(tabId, 'error', t('browser.info.consoleTimeout'), 'result')
    }, 4000)
    evalWaitRef.current = { nonce: req.nonce, timer }
  }, [state.evalRequest, t, tabId])

  useEffect(() => {
    const req = state.probeRequest
    if (req === null) return
    if (!consumeBrowserProbe(tabId, req.nonce)) return
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'probe' }, '*')
  }, [state.probeRequest, tabId])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (data === null || typeof data !== 'object' || data.source !== BROWSER_MSG_SOURCE) return
      const type = data.type
      if (type === 'ready' || type === 'page') {
        const url = typeof data.url === 'string' ? data.url : state.committed
        const title = typeof data.title === 'string' ? data.title : ''
        const ua = typeof data.ua === 'string' ? data.ua : ''
        const viewportRaw = data.viewport
        const viewport = viewportRaw !== null && typeof viewportRaw === 'object'
          ? {
            w: Number((viewportRaw as { w?: unknown }).w) || 0,
            h: Number((viewportRaw as { h?: unknown }).h) || 0,
          }
          : { w: 0, h: 0 }
        patchBrowserTab(tabId, {
          status: 'ok',
          title,
          page: {
            url,
            title,
            ua,
            viewport,
            secure: data.secure === true,
            cookiesEnabled: data.cookiesEnabled !== false,
          },
        })
        onTitle(title, url)
        if (inspectRef.current) postInspect(true)
        return
      }
      if (type === 'fail') {
        const message = typeof data.message === 'string' ? data.message : t('browser.fail')
        const hint = typeof data.hint === 'string' ? data.hint : t('browser.failHint')
        patchBrowserTab(tabId, { status: 'fail', failMessage: message, failHint: hint })
        return
      }
      if (type === 'nav' && typeof data.url === 'string') {
        navigate(data.url)
        return
      }
      if (type === 'console' && typeof data.text === 'string') {
        const level = data.level === 'warn' || data.level === 'error' || data.level === 'info'
          ? data.level
          : 'log'
        pushBrowserConsole(tabId, level as BrowserConsoleLine['level'], data.text)
        return
      }
      if (type === 'console-clear') {
        clearBrowserConsole(tabId)
        return
      }
      if (type === 'eval-result') {
        const nonce = Number(data.id)
        if (evalWaitRef.current !== null && evalWaitRef.current.nonce === nonce) {
          window.clearTimeout(evalWaitRef.current.timer)
          evalWaitRef.current = null
        }
        const ok = data.ok !== false
        const text = typeof data.text === 'string' ? data.text : (ok ? 'undefined' : t('browser.info.consoleEvalFailed'))
        pushBrowserConsole(tabId, ok ? 'log' : 'error', text, 'result')
        return
      }
      if (type === 'net') {
        upsertBrowserNetwork(tabId, data.entries ?? data.entry)
        return
      }
      if (type === 'app') {
        setBrowserApp(tabId, data)
        return
      }
      if (type === 'css') {
        setBrowserCss(tabId, data)
        return
      }
      if (type === 'files') {
        setBrowserFiles(tabId, data.files)
        return
      }
      if (type === 'pick') {
        const snapshot = normalizeBrowserElSnapshot(data.snapshot)
        if (snapshot === null) {
          setFlash({ kind: 'err', text: t('browser.el.failed') })
          return
        }
        const ok = onPick(snapshot)
        setFlash({
          kind: ok ? 'ok' : 'err',
          text: ok ? t('browser.el.inserted', { tag: snapshot.tag }) : t('browser.el.failed'),
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [onPick, onTitle, state.committed, t, tabId])

  const navigate = (raw: string): void => {
    const url = normalizeBrowserUrl(raw)
    if (url === null) {
      setInvalid(true)
      patchBrowserTab(tabId, { failMessage: t('browser.badUrl'), failHint: t('browser.badUrlHint') })
      return
    }
    if (typeof location !== 'undefined' && isWorkbenchSelfUrl(url, location.href)) {
      setInvalid(true)
      patchBrowserTab(tabId, {
        failMessage: t('browser.self'),
        failHint: t('browser.selfHint'),
        status: 'fail',
      })
      return
    }
    setInvalid(false)
    commitBrowserUrl(tabId, url)
    onTitle('', url)
  }

  const submitAddress = (): void => {
    navigate(state.input)
  }

  const toggleInspect = (): void => {
    if (state.committed === '') {
      setFlash({ kind: 'err', text: t('browser.inspectNeedPage') })
      return
    }
    const next = !state.inspect
    patchBrowserTab(tabId, { inspect: next })
    postInspect(next)
  }

  return (
    <div className={css.root} data-inspect={state.inspect || undefined}>
      <div className={css.bar}>
        <div className={css.nav}>
          <IconButton
            label={t('browser.back')}
            disabled={!canBrowserBack(state)}
            onClick={() => { goBrowserHistory(tabId, -1) }}
          >
            <IconChevronLeft />
          </IconButton>
          <IconButton
            label={t('browser.forward')}
            disabled={!canBrowserForward(state)}
            onClick={() => { goBrowserHistory(tabId, 1) }}
          >
            <IconChevronRight />
          </IconButton>
          <IconButton
            label={t('browser.reload')}
            disabled={state.committed === ''}
            onClick={() => {
              if (state.committed === '') return
              beginBrowserLoad(tabId)
              const frame = frameRef.current
              if (frame !== null) frame.src = browserViewSrc(state.committed)
            }}
          >
            <IconRefresh />
          </IconButton>
        </div>
        <input
          className={css.address}
          data-invalid={invalid || undefined}
          value={state.input}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={t('browser.address')}
          onChange={(event) => {
            setInvalid(false)
            patchBrowserTab(tabId, { input: event.target.value })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitAddress()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              patchBrowserTab(tabId, { input: state.committed })
              setInvalid(false)
            }
          }}
        />
        <div className={css.actions}>
          <IconButton
            label={state.inspect ? t('browser.inspectOn') : t('browser.inspect')}
            active={state.inspect}
            onClick={toggleInspect}
          >
            <IconInspect />
          </IconButton>
          <IconButton label={t('browser.devtools')} onClick={onOpenDevtools}>
            <IconDevtools />
          </IconButton>
        </div>
      </div>
      {state.inspect ? (
        <div className={css.hint} data-kind="inspect">{t('browser.inspectHint')}</div>
      ) : flash !== null ? (
        <div className={css.hint} data-kind={flash.kind}>{flash.text}</div>
      ) : state.status === 'fail' && state.failMessage !== '' ? (
        <div className={css.hint} data-kind="err">
          {state.failMessage}
          {state.failHint !== '' ? ` ${state.failHint}` : ''}
        </div>
      ) : invalid ? (
        <div className={css.hint} data-kind="err">{t('browser.badUrlHint')}</div>
      ) : null}
      <div className={css.stage}>
        {showEmpty ? (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t('browser.emptyTitle')}</p>
            <p className={css.emptyHint}>{t('browser.emptyHint')}</p>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            key={src}
            className={css.frame}
            title={t('browser.frame')}
            src={src}
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => {
              if (inspectRef.current) postInspect(true)
              frameRef.current?.contentWindow?.postMessage(
                { source: BROWSER_MSG_SOURCE, type: 'query' },
                '*',
              )
            }}
          />
        )}
        {state.status === 'loading' && !showEmpty ? (
          <div className={css.loading}>{t('browser.loading')}</div>
        ) : null}
      </div>
    </div>
  )
}
