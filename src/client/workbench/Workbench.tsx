import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserElSnapshot } from '../../shared/browser-el.ts'
import { redactSecrets } from '../../shared/redact.ts'
import type { GitFail, GitResult, ReviewSnapshot } from '../../shared/types.ts'
import {
  defaultWorkbenchChrome,
  getWorkbenchChrome,
  patchWorkbenchChrome,
  shouldSplitWorkbench,
  subscribeWorkbenchChrome,
  workbenchOwnsPortal,
} from './auto-open.ts'
import { ColSash } from './ColSash.tsx'
import {
  CHAT_MIN, CHAT_RATIO, CHAT_W_KEY, EDITOR_MIN, RAIL_W,
  SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_W_KEY,
  clamp, clampLayout, readPx, writePx,
} from './column-layout.ts'
import {
  clampTermHeight,
  fileTabsOf,
  layoutBottomSpan,
  loadBottomSpan,
  loadBottomTool,
  loadTermDock,
  loadTermPanelOpen,
  pickTabId,
  reservedAboveTerm,
  saveBottomSpan,
  saveBottomTool,
  saveTermDock,
  saveTermPanelOpen,
  TERM_DEFAULT_H,
  TERM_H_KEY,
  TERM_HEADER_H,
  termTabsOf,
  visibleTermId,
  type BottomSpan,
  type BottomTool,
  type TermDock,
} from './bottom-layout.ts'
import { EditorPane } from './EditorPane.tsx'
import {
  bottomChromeVisible,
  loadDevtoolsDock,
  loadDevtoolsOpen,
  saveDevtoolsDock,
  saveDevtoolsOpen,
  type DevtoolsDock,
} from './browser-dock.ts'
import {
  dropBrowserTab,
  setActiveBrowserId,
} from './browser-session.ts'
import { browserElExisting } from './browser-el-client.ts'
import { DevToolsPanel } from './DevToolsPanel.tsx'
import { loadEditorMode, saveEditorMode, type EditorModeId } from './editor-mode.ts'
import { IconButton } from './IconButton.tsx'
import { IconChat } from './icons.tsx'
import { ensureIdeStyles } from './ide-host.css.ts'
import railCss from './Rail.module.css'
import { openOfficialSidebarTab } from './official-sidebar.ts'
import { SideDock } from './SideDock.tsx'
import {
  applyReviewLiveSnapshot,
  readReviewLive,
  retainReviewLive,
  subscribeReviewLive,
} from './review-live.ts'
import { getReviewOn, subscribeReviewOn } from './review-settings.ts'
import { termIdFromTabId } from '../../shared/new-file-path.ts'
import type { TermCleanExitAction } from './term-session.ts'
import { TERMINAL_TAB_ID, CONTROL_PLANE_TAB_ID, type FileBuffer, type FileTab, type Translate, type WorkbenchInjected } from './types.ts'
import { previewKindOfPath } from '../../shared/preview-kind.ts'
import { isCanvasPath, type CanvasViewMode } from '../../shared/canvas-path.ts'
import { requestCanvasView } from './canvas-view-prefs.ts'
import { retainCanvasLive } from './canvas-live.ts'
import { isTermAssistHotkey, isTermNewTabHotkey } from '../../shared/term-assist.ts'
import { StatusBar } from './StatusBar.tsx'
import { UsageNavPortal } from './UsagePanel.tsx'
import { TerminalPanel } from './TerminalPanel.tsx'
import { STATUS_BAR_H } from './status-bar.ts'
import { DEFAULT_TERM_AI_OPEN, TERM_AI_OPEN_KEY, readBoolFlag, writeBoolFlag } from './ui-flags.ts'
import { useControlPlaneVisible } from './control-plane-settings.ts'
import { usePluginUpdate, visibleUpdate } from './UpdateBanner.tsx'
import { updateTermSeed } from '../../shared/version.ts'
import { useWorkspace } from './useWorkspace.ts'
import { useAttentionCounts, useSessionBeep, playWorkbenchSound } from './useSessionMonitor.ts'
import { bindUsageLiveSession } from './usage-live.ts'
import {
  composerSeatOf,
  composerSelection,
  focusComposer,
  dragCarriesFileRef,
  fileRefExisting,
  markLongFileRefChips,
  readDragKind,
  readDragPath,
} from './file-ref-client.ts'
import {
  dragCarriesNetRef,
  netRefExisting,
  readDragNetRef,
} from './net-ref-client.ts'
import type { NetRefApi } from './net-ref-client.ts'
import { termRefExisting } from './term-ref-client.ts'
import { editorRefExisting } from './editor-ref-client.ts'
import type { NetRefSnapshot } from '../../shared/browser-net-ref.ts'
import type { EditorRefSnapshot } from '../../shared/editor-ref.ts'
import css from './Workbench.module.css'

export type WorkbenchProps =
  PropsRuntime<'conversation.input.overlay'>
  & WorkbenchInjected
  & PropsLocale<'workbench'>

function fileTabId(path: string): string {
  return `file:${path}`
}

function diffTabId(path: string, staged: boolean): string {
  return `diff:${staged ? '1' : '0'}:${path}`
}

function commitDiffTabId(hash: string, path: string): string {
  return `commit:${hash}:${path}`
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** Conversation column root — parent of the native scrollport. Never split the scrollport itself. */
function findConversationColumn(): HTMLElement | null {
  const scroll = document.querySelector('[data-conversation-scroll]')
  const root = scroll?.parentElement
  return root instanceof HTMLElement ? root : null
}

class WorkbenchGate extends Component<{ children: ReactNode; t: Translate }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[workbench]', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      const detail = redactSecrets(this.state.error.message).trim()
      return (
        <div className={css.crash} data-git-ide-panel="crash" role="alert">
          <p className={css.crashTitle}>{this.props.t('ide.crash')}</p>
          {detail !== '' ? <p className={css.crashDetail}>{this.props.t('ide.crashReason', { detail })}</p> : null}
          <p className={css.crashHint}>{this.props.t('ide.crashHint')}</p>
        </div>
      )
    }
    return this.props.children
  }
}

/** Always-on host portal: StatusBar + chrome; files/git live in official sidebar. */
export function Workbench(props: WorkbenchProps) {
  const mount = props.mount ?? 'host'
  if (!workbenchOwnsPortal(mount)) return null
  return (
    <WorkbenchGate t={props.t}>
      <WorkbenchInner {...props} />
    </WorkbenchGate>
  )
}

function WorkbenchInner(props: WorkbenchProps) {
  const { client, t, useSessions, useWorkspaces, sessionId, fileRefs, browserEls, netRefs, termRefs, editorRefs } = props
  const chrome = useSyncExternalStore(subscribeWorkbenchChrome, getWorkbenchChrome, defaultWorkbenchChrome)
  const { enabled, chatOpen, editorOpen, sideOpen, sideTab } = chrome
  const currentSession = useSessions(state => state.current) as string | undefined
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [controlPlaneOn] = useControlPlaneVisible()
  const [tabs, setTabs] = useState<FileTab[]>(() => [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({})
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; staged: boolean } | null>(null)
  const [fileError, setFileError] = useState<GitFail | null>(null)
  const [chatW, setChatW] = useState(() => readPx(CHAT_W_KEY, 0))
  const [sideW, setSideW] = useState(() => readPx(SIDE_W_KEY, SIDE_DEFAULT))
  const [dragging, setDragging] = useState<null | 'chat' | 'side' | 'term'>(null)
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const [updateHidden, setUpdateHidden] = useState(false)
  const [aiTermIds, setAiTermIds] = useState<string[]>(() => (
    readBoolFlag(TERM_AI_OPEN_KEY, DEFAULT_TERM_AI_OPEN) ? [TERMINAL_TAB_ID] : []
  ))
  const [editorMode, setEditorMode] = useState<EditorModeId>(() => loadEditorMode())
  const [termDock, setTermDock] = useState<TermDock>(() => loadTermDock())
  const [bottomSpan, setBottomSpan] = useState<BottomSpan>(() => loadBottomSpan())
  const [termH, setTermH] = useState(() => readPx(TERM_H_KEY, TERM_DEFAULT_H))
  const [termPanelOpen, setTermPanelOpen] = useState(() => loadTermPanelOpen())
  const [termPanelShown, setTermPanelShown] = useState(true)
  const [lastFileId, setLastFileId] = useState<string | null>(null)
  const [lastTermId, setLastTermId] = useState(TERMINAL_TAB_ID)
  const [devtoolsDock, setDevtoolsDock] = useState<DevtoolsDock>(() => loadDevtoolsDock())
  const [devtoolsOpen, setDevtoolsOpen] = useState(() => loadDevtoolsOpen())
  const [bottomTool, setBottomTool] = useState<BottomTool>(() => {
    const saved = loadBottomTool()
    return saved === 'devtools' ? 'terminal' : saved
  })

  // DevTools is session-only: never restore an open panel or sidebar tab from persisted chrome.
  useEffect(() => {
    if (getWorkbenchChrome().sideTab === 'devtools') {
      patchWorkbenchChrome({ sideTab: 'files' })
    }
  }, [])

  // Usage balance follows harness current session, not whichever Workbench retain() ran last.
  useEffect(() => {
    bindUsageLiveSession(currentSession)
  }, [currentSession])
  const changeEditorMode = useCallback((mode: EditorModeId): void => {
    saveEditorMode(mode)
    setEditorMode(mode)
  }, [])
  const changeTermDock = useCallback((dock: TermDock): void => {
    saveTermDock(dock)
    setTermDock(dock)
    if (dock === 'bottom') {
      setTermPanelShown(true)
      setTermPanelOpen(true)
      saveTermPanelOpen(true)
      return
    }
    patchWorkbenchChrome({ editorOpen: true })
  }, [])
  const changeBottomSpan = useCallback((span: BottomSpan): void => {
    saveBottomSpan(span)
    setBottomSpan(span)
  }, [])
  const changeTermPanelOpen = useCallback((open: boolean): void => {
    setTermPanelOpen(open)
    saveTermPanelOpen(open)
    if (open) setTermPanelShown(true)
  }, [])
  const revealTermPanel = useCallback((): void => {
    setTermPanelShown(true)
    setTermPanelOpen(true)
    saveTermPanelOpen(true)
  }, [])
  const pluginInfo = usePluginUpdate(client)
  const updateInfo = updateHidden ? null : visibleUpdate(pluginInfo)
  const termSeed = updateInfo === null || updateInfo.latest === null
    ? undefined
    : updateInfo.installAllowed
      ? updateTermSeed(
        updateInfo.command,
        t('update.termHint', { latest: updateInfo.latest, current: updateInfo.current }),
      )
      : updateTermSeed(
        '',
        t('update.termHintBlocked', {
          latest: updateInfo.latest,
          current: updateInfo.current,
          minHarness: updateInfo.minHarness,
        }),
      )

  const workspace = useWorkspace(useSessions, useWorkspaces)
  const workspaceId = workspace?.workspaceId
  const reviewSnap = useSyncExternalStore(subscribeReviewLive, readReviewLive, readReviewLive)
  const reviewOn = useSyncExternalStore(subscribeReviewOn, getReviewOn, getReviewOn)
  const reviewPending = reviewOn ? reviewSnap.files.length : 0
  const reviewPendingPrev = useRef(0)
  const [reviewBusy, setReviewBusy] = useState(false)
  /** Agent changes 面板点文件名后：请求编辑器定位到该文件第一个改动。 */
  const [reviewJump, setReviewJump] = useState<{ path: string; stamp: number } | null>(null)
  useEffect(() => retainReviewLive(client, workspaceId), [client, workspaceId])
  useLayoutEffect(() => {
    const prev = reviewPendingPrev.current
    reviewPendingPrev.current = reviewPending
    if (reviewOn && prev === 0 && reviewPending > 0) {
      patchWorkbenchChrome({ sideOpen: true, sideTab: 'review' })
    }
  }, [reviewPending, reviewOn])

  const reviewByPath = useMemo(() => {
    const map: Record<string, (typeof reviewSnap.files)[number]> = {}
    if (!reviewOn) return map
    for (const file of reviewSnap.files) map[file.path] = file
    return map
  }, [reviewSnap, reviewOn])

  const reloadOpenBuffer = useCallback(async (path: string): Promise<void> => {
    if (workspaceId === undefined) return
    if (buffersRef.current[path] === undefined) return
    const result = await client.readFile(workspaceId, path)
    if (!result.ok) {
      if (result.code === 'FS_NOT_FOUND') {
        setBuffers(current => {
          if (current[path] === undefined) return current
          const next = { ...current }
          delete next[path]
          return next
        })
      }
      return
    }
    setBuffers(current => current[path] === undefined
      ? current
      : {
        ...current,
        [path]: {
          ...current[path]!,
          original: result.value.content,
          draft: result.value.content,
          language: result.value.language,
        },
      })
  }, [client, workspaceId])

  const runReviewAction = useCallback(async (
    action: () => Promise<GitResult<ReviewSnapshot>>,
    reloadPaths: string[],
  ): Promise<void> => {
    if (workspaceId === undefined || reviewBusy) return
    setReviewBusy(true)
    try {
      const result = await action()
      if (!result.ok) {
        setFileError(result)
        return
      }
      setFileError(null)
      applyReviewLiveSnapshot(result.value)
      await Promise.all(reloadPaths.map(path => reloadOpenBuffer(path)))
    } finally {
      setReviewBusy(false)
    }
  }, [workspaceId, reviewBusy, reloadOpenBuffer])
  const { attention } = useAttentionCounts(useSessions, useWorkspaces)
  useSessionBeep(attention, playWorkbenchSound)
  const inputDraft = props.useInput?.(state => state.draft) ?? ''
  const inputPhase = props.useInput?.(state => state.phase) ?? ''
  const inputDraftRev = props.useInput?.(state => state.draftRev) ?? 0
  const inputOccurrences = props.useInput?.(state => state.occurrences) ?? []
  const fileRefDropRef = useRef({
    sessionId,
    draftLength: inputDraft.length,
    draftRev: inputDraftRev,
    phase: inputPhase,
    existing: fileRefExisting(inputOccurrences),
  })
  fileRefDropRef.current = {
    sessionId,
    draftLength: inputDraft.length,
    draftRev: inputDraftRev,
    phase: inputPhase,
    existing: fileRefExisting(inputOccurrences),
  }
  fileRefs?.rememberOccurrences(sessionId, fileRefDropRef.current.existing)
  browserEls?.rememberOccurrences(sessionId, browserElExisting(inputOccurrences))
  netRefs?.rememberOccurrences(sessionId, netRefExisting(inputOccurrences))
  termRefs?.rememberOccurrences(sessionId, termRefExisting(inputOccurrences))
  const running = Boolean(props.useSession?.(state => state.running))
  const pending = (props.useSession?.(state => state.pending)?.length ?? 0) as number
  const split = shouldSplitWorkbench(enabled)
  const termShown = termDock === 'bottom' && termPanelShown
  const panelOn = bottomChromeVisible(termDock, termPanelShown, { dock: devtoolsDock, open: devtoolsOpen })
  const spanNow = layoutBottomSpan(termDock, bottomSpan, { editor: editorOpen, side: sideOpen })
  const fileTabs = fileTabsOf(tabs)
  const termTabs = termTabsOf(tabs)
  const editorTabs = termDock === 'bottom' ? fileTabs : tabs
  const editorActiveId = termDock === 'bottom'
    ? pickTabId(fileTabs, tabs.find(tab => tab.id === activeId)?.kind !== 'terminal' ? activeId : lastFileId)
    : activeId
  const termActiveId = visibleTermId(tabs, activeId, lastTermId)

  useEffect(() => {
    const tab = tabs.find(item => item.id === activeId)
    if (tab === undefined) return
    if (tab.kind === 'terminal') setLastTermId(tab.id)
    else setLastFileId(tab.id)
    if (tab.kind === 'browser') setActiveBrowserId(tab.id)
  }, [activeId, tabs])

  useEffect(() => {
    if (running || pending > 0) patchWorkbenchChrome({ chatOpen: true })
  }, [running, pending])

  // Control plane / terminal / browser live in the official right Sidebar — never pin them as editor tabs.
  useEffect(() => {
    if (!controlPlaneOn) return
    setTabs((current) => current.filter(tab => tab.id !== CONTROL_PLANE_TAB_ID))
    setActiveId((current) => (current === CONTROL_PLANE_TAB_ID ? null : current))
  }, [controlPlaneOn])

  useEffect(() => {
    const id = requestAnimationFrame(() => { markLongFileRefChips() })
    return () => cancelAnimationFrame(id)
  }, [inputOccurrences, inputDraft])

  useLayoutEffect(() => {
    ensureIdeStyles()
    const found = findConversationColumn()
    if (found !== null) {
      setHost(found)
      return
    }
    const observer = new MutationObserver(() => {
      const next = findConversationColumn()
      if (next !== null) {
        setHost(next)
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [split])

  useEffect(() => {
    const scroll = host
    if (scroll === null) return
    const onFocus = (event: Event): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-composer-seat]') !== null) {
        patchWorkbenchChrome({ chatOpen: true })
      }
    }
    scroll.addEventListener('focusin', onFocus)
    return () => { scroll.removeEventListener('focusin', onFocus) }
  }, [host])

  useLayoutEffect(() => {
    const scroll = host
    if (scroll === null) return
    if (!split) {
      delete scroll.dataset.gitIde
      delete scroll.dataset.gitChat
      delete scroll.dataset.gitEditor
      delete scroll.dataset.gitSide
      delete scroll.dataset.gitTermOpen
      delete scroll.dataset.gitTermDock
      delete scroll.dataset.gitBottomSpan
      scroll.style.removeProperty('--git-col-chat')
      scroll.style.removeProperty('--git-col-editor')
      scroll.style.removeProperty('--git-col-side')
      scroll.style.removeProperty('--git-status-h')
      scroll.style.removeProperty('--git-term-h')
      return
    }
    scroll.dataset.gitIde = ''
    scroll.dataset.gitChat = chatOpen ? 'on' : 'off'
    scroll.dataset.gitEditor = 'off'
    scroll.dataset.gitSide = sideOpen ? 'on' : 'off'
    scroll.dataset.gitBottomSpan = spanNow
    delete scroll.dataset.gitTermDock
    delete scroll.dataset.gitTermOpen
    return () => {
      delete scroll.dataset.gitIde
      delete scroll.dataset.gitChat
      delete scroll.dataset.gitEditor
      delete scroll.dataset.gitSide
      delete scroll.dataset.gitTermOpen
      delete scroll.dataset.gitTermDock
      delete scroll.dataset.gitBottomSpan
    }
  }, [host, split, chatOpen, sideOpen, spanNow])

  useLayoutEffect(() => {
    const scroll = host
    if (scroll === null || !split) return
    const apply = (): void => {
      const hostW = scroll.clientWidth
      if (sideOpen) {
        const nextSide = clamp(sideW, SIDE_MIN, Math.min(SIDE_MAX, Math.max(SIDE_MIN, hostW - CHAT_MIN)))
        scroll.style.setProperty('--git-col-side', `${nextSide}px`)
      } else {
        scroll.style.removeProperty('--git-col-side')
      }
      scroll.style.setProperty('--git-status-h', `${STATUS_BAR_H}px`)
      scroll.style.removeProperty('--git-col-chat')
      scroll.style.removeProperty('--git-term-h')
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(scroll)
    return () => { observer.disconnect() }
  }, [host, split, sideOpen, sideW])

  const beginResize = (which: 'chat' | 'side', event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    // Capture the pointer so pointermove/pointerup keep arriving even when
    // the cursor leaves the window or moves over an iframe (BrowserView);
    // without capture a lost pointerup strands the drag listeners forever.
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* pointer already inactive */ }
    const startX = event.clientX
    const startChat = chatW
    const startSide = sideW
    const hostW = host?.clientWidth ?? 0
    const hostLeft = host?.getBoundingClientRect().left ?? 0
    let latestChat = startChat
    let latestSide = startSide
    let editorLive = editorOpen
    setDragging(which)
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent): void => {
      if (which === 'chat') {
        if (!editorLive && Math.abs(next.clientX - startX) > 8) {
          editorLive = true
          patchWorkbenchChrome({ editorOpen: true })
        }
        const maxChat = hostW - (editorLive ? EDITOR_MIN : RAIL_W) - (sideOpen ? startSide : RAIL_W)
        latestChat = editorLive && !editorOpen
          ? clamp(Math.round(next.clientX - hostLeft), CHAT_MIN, maxChat)
          : clamp(startChat + (next.clientX - startX), CHAT_MIN, maxChat)
        setChatW(latestChat)
      } else {
        const maxSide = Math.min(SIDE_MAX, hostW - (chatOpen ? startChat : RAIL_W) - (editorLive ? EDITOR_MIN : RAIL_W))
        latestSide = clamp(startSide - (next.clientX - startX), SIDE_MIN, maxSide)
        setSideW(latestSide)
      }
    }
    const end = (): void => {
      try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
      setDragging(null)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (which === 'chat') writePx(CHAT_W_KEY, latestChat)
      else writePx(SIDE_W_KEY, latestSide)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const resetChatWidth = (): void => {
    const hostW = host?.clientWidth ?? 0
    const next = clampLayout(hostW, Math.round(hostW * CHAT_RATIO), sideW, {
      chat: chatOpen, editor: editorOpen, side: sideOpen,
    })
    setChatW(next.chat)
    writePx(CHAT_W_KEY, next.chat)
  }

  const resetSideWidth = (): void => {
    const hostW = host?.clientWidth ?? 0
    const next = clampLayout(hostW, chatW, SIDE_DEFAULT, {
      chat: chatOpen, editor: editorOpen, side: sideOpen,
    })
    setSideW(next.side)
    writePx(SIDE_W_KEY, next.side)
  }

  const beginTermResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    // Capture the pointer so pointermove/pointerup keep arriving even when
    // the cursor leaves the window or moves over an iframe (BrowserView);
    // without capture a lost pointerup strands the drag listeners forever.
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* pointer already inactive */ }
    const hostH = host?.clientHeight ?? 0
    const startY = event.clientY
    const startH = clampTermHeight(termH, hostH, reservedAboveTerm(hostH))
    let latest = startH
    setDragging('term')
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent): void => {
      const liveH = host?.clientHeight ?? hostH
      latest = clampTermHeight(startH + (startY - next.clientY), liveH, reservedAboveTerm(liveH))
      setTermH(latest)
    }
    const end = (): void => {
      try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
      setDragging(null)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      writePx(TERM_H_KEY, latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const resetTermHeight = (): void => {
    setTermH(TERM_DEFAULT_H)
    writePx(TERM_H_KEY, TERM_DEFAULT_H)
  }

  const openFile = useCallback(async (path: string): Promise<void> => {
    void path
    openOfficialSidebarTab('files')
  }, [])

  useEffect(() => retainCanvasLive(client, workspaceId, (path) => {
    void path
    openOfficialSidebarTab('files')
  }), [client, workspaceId])

  const openFileFromReview = useCallback((path: string): void => {
    void path
    openOfficialSidebarTab('files')
  }, [])

  /** Keep open editor tabs and buffers in sync when a file or folder is renamed/moved. */
  const renamePath = (from: string, to: string): void => {
    if (from === to) return
    setTabs(current => current.map(tab => {
      if (tab.kind === 'terminal' || tab.kind === 'browser') return tab
      if (tab.path !== from && !tab.path.startsWith(from + '/')) return tab
      const nextPath = tab.path === from ? to : to + tab.path.slice(from.length)
      if (tab.kind === 'file' || tab.kind === 'preview') {
        return { ...tab, id: fileTabId(nextPath), path: nextPath, title: fileName(nextPath) }
      }
      if (tab.kind === 'diff') {
        return { ...tab, id: diffTabId(nextPath, tab.staged === true), path: nextPath }
      }
      return { ...tab, id: commitDiffTabId(tab.hash ?? '', nextPath), path: nextPath }
    }))
    setBuffers(current => {
      const next: Record<string, FileBuffer> = {}
      for (const [path, buffer] of Object.entries(current)) {
        if (path === from || path.startsWith(from + '/')) {
          const nextPath = path === from ? to : to + path.slice(from.length)
          next[nextPath] = { ...buffer, path: nextPath }
        } else {
          next[path] = buffer
        }
      }
      return next
    })
    setSelectedDiff(current => {
      if (current === null) return current
      if (current.path !== from && !current.path.startsWith(from + '/')) return current
      return { ...current, path: current.path === from ? to : to + current.path.slice(from.length) }
    })
  }

  /** Close editor tabs and drop buffers when a file or folder is deleted. */
  const deletePath = (path: string): void => {
    const closing = new Set<string>()
    setTabs(current => {
      const next = current.filter(tab => {
        if (tab.kind === 'terminal' || tab.kind === 'browser') return true
        if (tab.path === path || tab.path.startsWith(path + '/')) {
          closing.add(tab.id)
          return false
        }
        return true
      })
      return next
    })
    setBuffers(current => {
      const next = { ...current }
      for (const key of Object.keys(next)) {
        if (key === path || key.startsWith(path + '/')) delete next[key]
      }
      return next
    })
    setSelectedDiff(current => {
      if (current === null) return current
      return current.path === path || current.path.startsWith(path + '/') ? null : current
    })
    window.setTimeout(() => {
      setActiveId(current => current === null || closing.has(current) ? TERMINAL_TAB_ID : current)
    }, 0)
  }

  /** Open the workspace shell in the official right Sidebar. */
  const openNewTerminal = useCallback((): void => {
    openOfficialSidebarTab('terminal')
  }, [])

  /** Open the embedded browser in the official right Sidebar. */
  const openNewBrowser = useCallback((): void => {
    openOfficialSidebarTab('browser')
  }, [])

  const changeDevtoolsDock = useCallback((dock: DevtoolsDock): void => {
    saveDevtoolsDock(dock)
    setDevtoolsDock(dock)
    saveDevtoolsOpen(true)
    setDevtoolsOpen(true)
    // DevTools only docks in the legacy SideDock; bottom shell chrome is retired.
    saveBottomTool('terminal')
    setBottomTool('terminal')
    patchWorkbenchChrome({ sideOpen: true, sideTab: 'devtools' })
  }, [])

  const openDevtools = useCallback((): void => {
    changeDevtoolsDock('bottom')
  }, [changeDevtoolsDock])

  const pickBrowserEl = useCallback((snapshot: BrowserElSnapshot): boolean => {
    if (browserEls === undefined) return false
    const live = fileRefDropRef.current
    if (live.sessionId === undefined) return false
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
    const range = seat !== null
      ? composerSelection(seat, live.draftLength)
      : { start: live.draftLength, end: live.draftLength }
    return browserEls.insertChip({
      sessionId: live.sessionId,
      snapshot,
      span: { start: range.start, end: range.end, draftRev: live.draftRev },
      existing: browserElExisting(inputOccurrences),
      phase: live.phase,
    }, t)
  }, [browserEls, inputOccurrences, t])

  /** DevTools 网络请求 → 官方胶囊。右键菜单与拖拽 drop 共用。 */
  const sendNetToChat = useCallback((snapshot: NetRefSnapshot): boolean => {
    if (netRefs === undefined) return false
    const live = fileRefDropRef.current
    if (live.sessionId === undefined) return false
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
    const range = seat !== null
      ? composerSelection(seat, live.draftLength)
      : { start: live.draftLength, end: live.draftLength }
    return netRefs.insertChip({
      sessionId: live.sessionId,
      snapshot,
      span: { start: range.start, end: range.end, draftRev: live.draftRev },
      existing: netRefExisting(inputOccurrences),
      phase: live.phase,
    }, t)
  }, [netRefs, inputOccurrences, t])

  /** 终端选中内容 / 最近输出 → 官方胶囊（与文件、网络请求同一机制），附 pwd/shell 上下文。 */
  const sendTermToChat = useCallback((text: string, context?: string): boolean => {
    if (termRefs === undefined) return false
    const live = fileRefDropRef.current
    if (live.sessionId === undefined) return false
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
    const range = seat !== null
      ? composerSelection(seat, live.draftLength)
      : { start: live.draftLength, end: live.draftLength }
    return termRefs.insertChip({
      sessionId: live.sessionId,
      snapshot: context !== undefined && context !== '' ? { text, context } : { text },
      span: { start: range.start, end: range.end, draftRev: live.draftRev },
      existing: termRefExisting(inputOccurrences),
      phase: live.phase,
    }, t)
  }, [termRefs, inputOccurrences, t])

  /** 编辑器选中内容 / 整个文件 → 官方胶囊（与终端、网络请求同一机制），附文件路径上下文。 */
  const sendEditorToChat = useCallback((snapshot: EditorRefSnapshot): boolean => {
    if (editorRefs === undefined) return false
    const live = fileRefDropRef.current
    if (live.sessionId === undefined) return false
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
    const range = seat !== null
      ? composerSelection(seat, live.draftLength)
      : { start: live.draftLength, end: live.draftLength }
    return editorRefs.insertChip({
      sessionId: live.sessionId,
      snapshot,
      span: { start: range.start, end: range.end, draftRev: live.draftRev },
      existing: editorRefExisting(inputOccurrences),
      phase: live.phase,
    }, t)
  }, [editorRefs, inputOccurrences, t])

  /** 通用纯文本 → 官方输入框（DevTools 无胶囊通道时的兜底）。 */
  const sendTextToChat = useCallback((text: string): boolean => {
    if (netRefs === undefined) return false
    const live = fileRefDropRef.current
    if (live.sessionId === undefined) return false
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
    const range = seat !== null
      ? composerSelection(seat, live.draftLength)
      : { start: live.draftLength, end: live.draftLength }
    return netRefs.insertText({
      sessionId: live.sessionId,
      text,
      span: { start: range.start, end: range.end, draftRev: live.draftRev },
      phase: live.phase,
    }, t)
  }, [netRefs, inputOccurrences, t])

  const renameBrowserTitle = useCallback((tabId: string, title: string, url: string): void => {
    const host = (() => {
      try {
        return url === '' ? '' : new URL(url).host
      } catch {
        return ''
      }
    })()
    const nextTitle = title.trim() || host
    setTabs(current => current.map(tab => (
      tab.id === tabId && tab.kind === 'browser' ? { ...tab, title: nextTitle } : tab
    )))
  }, [])

  const toggleTermAi = useCallback((tabId: string, open: boolean): void => {
    setAiTermIds(current => {
      const has = current.includes(tabId)
      const next = open && !has
        ? [...current, tabId]
        : !open && has
          ? current.filter(id => id !== tabId)
          : current
      writeBoolFlag(TERM_AI_OPEN_KEY, next.length > 0)
      return next
    })
  }, [])

  useEffect(() => {
    // Global within the workbench: works whether focus is in the terminal,
    // the tab bar, the editor, or the side panel. xterm never sees Alt+J / Alt+I.
    const onKey = (event: KeyboardEvent): void => {
      if (isTermNewTabHotkey(event)) {
        event.preventDefault()
        event.stopPropagation()
        openNewTerminal()
        return
      }
      if (!isTermAssistHotkey(event)) return
      const showing = termDock === 'bottom' || tabs.find(tab => tab.id === activeId)?.kind === 'terminal'
      if (!showing) return
      event.preventDefault()
      event.stopPropagation()
      if (termDock === 'bottom' && (!termPanelOpen || !termPanelShown)) changeTermPanelOpen(true)
      const id = visibleTermId(tabs, activeId, lastTermId)
      setAiTermIds(current => {
        const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id]
        writeBoolFlag(TERM_AI_OPEN_KEY, next.length > 0)
        return next
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [activeId, changeTermPanelOpen, lastTermId, openNewTerminal, tabs, termDock, termPanelOpen, termPanelShown])

  useEffect(() => {
    fileRefs?.bindWorkspace(sessionId, workspaceId)
    return () => { fileRefs?.bindWorkspace(sessionId, undefined) }
  }, [fileRefs, sessionId, workspaceId])

  /**
   * Drag a file-tree node or a DevTools network row onto the composer:
   * mint an official InputBar chip (U+FFFC + occurrence) via
   * insert-reference. Do not write a path string.
   */
  useEffect(() => {
    if (fileRefs === undefined && netRefs === undefined) return
    const clearMark = (seat: HTMLElement): void => {
      seat.removeAttribute('data-dsh-drop-target')
    }
    const carries = (dt: DataTransfer | null): boolean =>
      dragCarriesFileRef(dt) || dragCarriesNetRef(dt)
    const onDragOver = (event: DragEvent): void => {
      if (!carries(event.dataTransfer)) return
      const seat = composerSeatOf(event.target)
      if (seat === null) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      seat.setAttribute('data-dsh-drop-target', '')
    }
    const onDragLeave = (event: DragEvent): void => {
      const seat = composerSeatOf(event.target)
      if (seat !== null) clearMark(seat)
    }
    const onDrop = (event: DragEvent): void => {
      const seat = composerSeatOf(event.target)
      if (seat === null) return
      event.preventDefault()
      event.stopPropagation()
      clearMark(seat)
      const live = fileRefDropRef.current
      if (live.sessionId === undefined) return
      const range = composerSelection(seat, live.draftLength)
      const span = { start: range.start, end: range.end, draftRev: live.draftRev }
      let ok = false
      const rel = readDragPath(event.dataTransfer)
      if (rel !== null && fileRefs !== undefined) {
        ok = fileRefs.insertChip({
          sessionId: live.sessionId,
          kind: readDragKind(event.dataTransfer),
          relPath: rel,
          span,
          existing: live.existing,
          phase: live.phase,
        }, t)
      } else {
        const net = readDragNetRef(event.dataTransfer)
        if (net !== null && netRefs !== undefined) {
          ok = netRefs.insertChip({
            sessionId: live.sessionId,
            snapshot: net,
            span,
            existing: netRefExisting(inputOccurrences),
            phase: live.phase,
          }, t)
        }
      }
      if (ok) focusComposer(seat)
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [fileRefs, netRefs, t, inputOccurrences])

  const closeTab = (id: string): void => {
    closeTabs([id])
  }

  const closeTabs = (ids: string[]): void => {
    const closable = ids.filter(id => id !== TERMINAL_TAB_ID && id !== CONTROL_PLANE_TAB_ID)
    if (closable.length === 0) return
    if (workspaceId !== undefined) {
      for (const id of closable) {
        if (id.startsWith('terminal:')) void client.closeTerm(workspaceId, termIdFromTabId(id))
        if (id.startsWith('browser:')) dropBrowserTab(id)
      }
    } else {
      for (const id of closable) {
        if (id.startsWith('browser:')) dropBrowserTab(id)
      }
    }
    const closing = new Set(closable)
    // Drop the AI-open marks for closed tabs outside the updater: React may
    // run updater functions more than once, and side effects belong here.
    const remainingAi = aiTermIds.filter(id => !closing.has(id))
    writeBoolFlag(TERM_AI_OPEN_KEY, remainingAi.length > 0)
    setAiTermIds(remainingAi)
    setTabs((current) => {
      for (const tab of current) {
        if (tab.kind === 'file' && closing.has(tab.id)) {
          setBuffers((buffersNow) => {
            if (buffersNow[tab.path] === undefined) return buffersNow
            const nextBuffers = { ...buffersNow }
            delete nextBuffers[tab.path]
            return nextBuffers
          })
        }
      }
      const next = current.filter(tab => !closing.has(tab.id))
      setActiveId((active) => {
        if (active === null || !closing.has(active)) return active
        const index = current.findIndex(tab => tab.id === active)
        return next[index]?.id ?? next[index - 1]?.id ?? TERMINAL_TAB_ID
      })
      return next
    })
  }

  const handleTermCleanExit = (tabId: string): TermCleanExitAction => {
    if (tabId !== TERMINAL_TAB_ID) {
      closeTab(tabId)
      return 'close'
    }
    if (termDock === 'bottom') {
      setTermPanelShown(false)
      return 'close'
    }
    if (lastFileId !== null) setActiveId(lastFileId)
    return 'hide'
  }

  if (!split || host === null) return null
  return createPortal(
    <>
      {chatOpen ? null : (
        <div className={railCss.rail} data-edge="start" data-git-ide-panel="rail-chat">
          <IconButton label={t('ide.showChat')} onClick={() => { patchWorkbenchChrome({ chatOpen: true }) }}>
            <IconChat />
          </IconButton>
        </div>
      )}
      {sideOpen ? (
        <SideDock
          client={client}
          workspaceId={workspaceId}
          tab={sideTab}
          onTab={(tab) => {
            if (tab === 'devtools') changeDevtoolsDock('side')
            else patchWorkbenchChrome({ sideOpen: true, sideTab: tab })
          }}
          onOpenFile={(path) => { void openFile(path) }}
          onOpenReviewFile={openFileFromReview}
          onCollapse={() => { patchWorkbenchChrome({ sideOpen: false }) }}
          update={updateInfo}
          onDismissUpdate={() => { setUpdateHidden(true) }}
          t={t}
          devtoolsDock={devtoolsDock}
          onDevtoolsDock={changeDevtoolsDock}
          showDevtoolsTab={devtoolsOpen}
          onAddNetToChat={sendNetToChat}
          onAddTextToChat={sendTextToChat}
        />
      ) : null}
      <UsageNavPortal
        client={client}
        sessionId={sessionId}
        running={running}
        useProjection={props.useProjection}
        t={t}
      />
      <div data-git-ide-panel="bottom">
        <StatusBar
          client={client}
          workspaceId={workspaceId}
          sessionId={sessionId}
          running={running}
          useProjection={props.useProjection}
          active={null}
          plugin={pluginInfo}
          tabs={[]}
          aiTermIds={aiTermIds}
          editorMode={editorMode}
          editorOpen={false}
          sideOpen={sideOpen}
          termDock={termDock}
          bottomSpan={bottomSpan}
          onEditorModeChange={changeEditorMode}
          onTermDockChange={() => { openOfficialSidebarTab('terminal') }}
          onBottomSpanChange={changeBottomSpan}
          onActivate={() => { openOfficialSidebarTab('files') }}
          onPrepareUpdate={() => { openOfficialSidebarTab('terminal') }}
          showDevtools={devtoolsOpen}
          onOpenSettings={() => { patchWorkbenchChrome({ sideOpen: true, sideTab: 'settings' }) }}
          onOpenDevtools={() => { changeDevtoolsDock('side') }}
          t={t}
        />
      </div>
      {sideOpen ? (
        <div data-git-ide-panel="sash-side">
          <ColSash
            label={t('ide.resizeSide')}
            active={dragging === 'side'}
            onPointerDown={(event) => { beginResize('side', event) }}
            onReset={resetSideWidth}
          />
        </div>
      ) : null}
    </>,
    host,
  )
}