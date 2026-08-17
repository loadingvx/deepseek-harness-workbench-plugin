import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as ReactNs from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitFail } from '../../shared/types.ts'
import {
  defaultWorkbenchChrome,
  getWorkbenchChrome,
  patchWorkbenchChrome,
  resetWorkbenchChrome,
  shouldSplitWorkbench,
  subscribeWorkbenchChrome,
  workbenchOwnsPortal,
  workbenchShowsToggle,
} from './auto-open.ts'
import { ColSash } from './ColSash.tsx'
import {
  CHAT_MIN, CHAT_RATIO, CHAT_W_KEY, EDITOR_MIN, RAIL_W,
  SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_W_KEY,
  clamp, clampLayout, readPx, writePx,
} from './column-layout.ts'
import { EditorPane } from './EditorPane.tsx'
import { loadEditorMode, saveEditorMode, type EditorModeId } from './editor-mode.ts'
import { IconButton } from './IconButton.tsx'
import { IconChat, IconEditor, IconFiles, IconGit, IconLayout, IconUsage } from './icons.tsx'
import { ensureIdeStyles } from './ide-host.css.ts'
import railCss from './Rail.module.css'
import { SideDock, type SideTab } from './SideDock.tsx'
import { termIdFromTabId } from '../../shared/new-file-path.ts'
import { createTerminalTab, nextTerminalTab, TERMINAL_TAB_ID, type FileBuffer, type FileTab, type WorkbenchInjected } from './types.ts'
import { previewKindOfPath } from '../../shared/preview-kind.ts'
import { isTermNewTabHotkey } from '../../shared/term-assist.ts'
import { StatusBar } from './StatusBar.tsx'
import { STATUS_BAR_H } from './status-bar.ts'
import { usePluginUpdate, visibleUpdate } from './UpdateBanner.tsx'
import { updateTermSeed } from '../../shared/version.ts'
import { useWorkspace } from './useWorkspace.ts'
import css from './Workbench.module.css'

export type WorkbenchProps =
  PropsRuntime<'conversation.session.header.utilities'>
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

let __wbRenderCount = 0
let __wbActiveId = 0
function __wbHookKinds(fiber: unknown): string[] {
  const kind = (h: unknown): string => {
    const ms = (h as { memoizedState?: unknown } | null)?.memoizedState
    if (ms !== null && typeof ms === 'object' && ms !== undefined && 'deps' in (ms as object)) return 'effect'
    if (ms !== null && typeof ms === 'object' && ms !== undefined && 'queue' in (ms as object)) return 'state'
    return ms === undefined ? 'undef' : ms === null ? 'null' : typeof ms
  }
  const out: string[] = []
  let h = fiber as { next?: unknown } | null
  let i = 0
  while (h && i < 80) {
    out.push(`${i}:${kind(h)}`)
    h = h.next as { next?: unknown } | null
    i++
  }
  return out
}
function __wbDump(tag: string, fiber: unknown): string {
  try {
    const f = fiber as { memoizedState?: unknown; alternate?: { memoizedState?: unknown } }
    const wip = __wbHookKinds(f.memoizedState)
    const cur = f.alternate ? __wbHookKinds(f.alternate.memoizedState) : []
    const max = Math.max(wip.length, cur.length)
    const diffs: string[] = []
    for (let i = 0; i < max; i++) {
      const a = wip[i] ?? '(none)'
      const b = cur[i] ?? '(none)'
      if (a.split(':')[1] !== b.split(':')[1]) diffs.push(`${i} wip=${a} cur=${b}`)
    }
    return `[FIBER]${tag} wip=${wip.length} cur=${cur.length} diffs=[${diffs.join(' | ')}] wip=${wip.join(',')} cur=${cur.join(',')}`
  } catch (e) {
    return `[FIBER]${tag} dump failed: ${String(e)}`
  }
}

/** Header toggle + portal: native chat stays left; editor and files/git split to the right. */
export function Workbench(props: WorkbenchProps) {
  __wbRenderCount += 1
  __wbActiveId += 1
  const renderId = __wbActiveId
  console.log('[WB-DEBUG] render', renderId, __wbRenderCount, { useSessionType: typeof props.useSession })
  try {
    const mount = props.mount ?? 'toggle'
    if (workbenchShowsToggle(mount)) return <WorkbenchToggle t={props.t} />
    if (!workbenchOwnsPortal(mount)) return null
    return <WorkbenchInner {...props} />
  } catch (error) {
    let dump = ''
    try {
      const ns = ReactNs as unknown as { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: { ReactCurrentOwner?: { current?: unknown } } }
      const owner = ns.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner?.current
      if (owner !== undefined) dump = __wbDump('CRASH', owner)
    } catch { /* ignore */ }
    console.error('[WB-CATCH]', renderId, __wbRenderCount, String(error), dump)
    throw error
  }
}

function WorkbenchToggle({ t }: Pick<WorkbenchProps, 't'>) {
  const chrome = useSyncExternalStore(subscribeWorkbenchChrome, getWorkbenchChrome, defaultWorkbenchChrome)
  return (
    <div className={css.host}>
      <button
        type="button"
        className={css.toggle}
        data-active={chrome.enabled || undefined}
        title={t('ide.toggle')}
        aria-label={t('ide.toggle')}
        aria-pressed={chrome.enabled}
        onClick={() => { patchWorkbenchChrome({ enabled: !chrome.enabled }) }}
      >
        <IconLayout />
        <span>{t('ide.toggleLabel')}</span>
      </button>
      {chrome.enabled && !chrome.chatOpen ? (
        <IconButton label={t('ide.showChat')} onClick={() => { patchWorkbenchChrome({ chatOpen: true }) }}>
          <IconChat />
        </IconButton>
      ) : null}
    </div>
  )
}

function WorkbenchInner(props: WorkbenchProps) {
  const { client, t, useSessions, useWorkspaces, sessionId } = props
  const chrome = useSyncExternalStore(subscribeWorkbenchChrome, getWorkbenchChrome, defaultWorkbenchChrome)
  const { enabled, chatOpen, editorOpen, sideOpen } = chrome
  const [sideTab, setSideTab] = useState<SideTab>('files')
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [tabs, setTabs] = useState<FileTab[]>(() => [createTerminalTab()])
  const [activeId, setActiveId] = useState<string | null>(TERMINAL_TAB_ID)
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({})
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; staged: boolean } | null>(null)
  const [fileError, setFileError] = useState<GitFail | null>(null)
  const [chatW, setChatW] = useState(() => readPx(CHAT_W_KEY, 0))
  const [sideW, setSideW] = useState(() => readPx(SIDE_W_KEY, SIDE_DEFAULT))
  const [dragging, setDragging] = useState<null | 'chat' | 'side'>(null)
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const [updateHidden, setUpdateHidden] = useState(false)
  const [aiTermIds, setAiTermIds] = useState<string[]>([])
  const [editorMode, setEditorMode] = useState<EditorModeId>(() => loadEditorMode())
  const changeEditorMode = useCallback((mode: EditorModeId): void => {
    saveEditorMode(mode)
    setEditorMode(mode)
  }, [])
  const pluginInfo = usePluginUpdate(client)
  const updateInfo = updateHidden ? null : visibleUpdate(pluginInfo)
  const termSeed = updateInfo === null || updateInfo.latest === null
    ? undefined
    : updateTermSeed(
      updateInfo.command,
      t('update.termHint', { latest: updateInfo.latest, current: updateInfo.current }),
    )

  const workspace = useWorkspace(useSessions, useWorkspaces)
  const workspaceId = workspace?.workspaceId
  const running = Boolean(props.useSession?.(state => state.running))
  const pending = (props.useSession?.(state => state.pending)?.length ?? 0) as number
  const split = shouldSplitWorkbench(enabled)

  useLayoutEffect(() => {
    resetWorkbenchChrome()
  }, [sessionId])

  useEffect(() => {
    if (running || pending > 0) patchWorkbenchChrome({ chatOpen: true })
  }, [running, pending])

  useEffect(() => {
    if (updateInfo === null) return
    patchWorkbenchChrome({ editorOpen: true, sideOpen: true })
    setActiveId(TERMINAL_TAB_ID)
  }, [updateInfo])

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
      scroll.style.removeProperty('--git-col-chat')
      scroll.style.removeProperty('--git-col-editor')
      scroll.style.removeProperty('--git-col-side')
      scroll.style.removeProperty('--git-status-h')
      return
    }
    scroll.dataset.gitIde = ''
    scroll.dataset.gitChat = chatOpen ? 'on' : 'off'
    scroll.dataset.gitEditor = editorOpen ? 'on' : 'off'
    scroll.dataset.gitSide = sideOpen ? 'on' : 'off'
    return () => {
      delete scroll.dataset.gitIde
      delete scroll.dataset.gitChat
      delete scroll.dataset.gitEditor
      delete scroll.dataset.gitSide
    }
  }, [host, split, chatOpen, editorOpen, sideOpen])

  useLayoutEffect(() => {
    const scroll = host
    if (scroll === null || !split) return
    const apply = (): void => {
      const hostW = scroll.clientWidth
      if (chatW <= 0 && hostW > 0) {
        setChatW(Math.round(hostW * CHAT_RATIO))
        return
      }
      const next = clampLayout(hostW, chatW, sideW, { chat: chatOpen, editor: editorOpen, side: sideOpen })
      scroll.style.setProperty('--git-col-chat', `${next.chat}px`)
      scroll.style.setProperty('--git-col-side', `${next.side}px`)
      scroll.style.setProperty('--git-status-h', `${STATUS_BAR_H}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(scroll)
    return () => { observer.disconnect() }
  }, [host, split, chatOpen, editorOpen, sideOpen, chatW, sideW])

  const beginResize = (which: 'chat' | 'side', event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startChat = chatW
    const startSide = sideW
    const hostW = host?.clientWidth ?? 0
    let latestChat = startChat
    let latestSide = startSide
    setDragging(which)
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent): void => {
      if (which === 'chat') {
        const maxChat = hostW - (editorOpen ? EDITOR_MIN : RAIL_W) - (sideOpen ? startSide : RAIL_W)
        latestChat = clamp(startChat + (next.clientX - startX), CHAT_MIN, maxChat)
        setChatW(latestChat)
      } else {
        const maxSide = Math.min(SIDE_MAX, hostW - (chatOpen ? startChat : RAIL_W) - (editorOpen ? EDITOR_MIN : RAIL_W))
        latestSide = clamp(startSide - (next.clientX - startX), SIDE_MIN, maxSide)
        setSideW(latestSide)
      }
    }
    const up = (): void => {
      setDragging(null)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (which === 'chat') writePx(CHAT_W_KEY, latestChat)
      else writePx(SIDE_W_KEY, latestSide)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (workspaceId === undefined) return
    patchWorkbenchChrome({ editorOpen: true })
    const id = fileTabId(path)
    const previewKind = previewKindOfPath(path)
    if (previewKind !== null) {
      setTabs(current => current.some(tab => tab.id === id)
        ? current
        : [...current, { id, kind: 'preview', path, title: fileName(path), preview: previewKind }])
      setActiveId(id)
      return
    }
    setTabs((current) => current.some(tab => tab.id === id)
      ? current
      : [...current, { id, kind: 'file', path, title: fileName(path) }])
    setActiveId(id)
    if (buffersRef.current[path] !== undefined) return
    const result = await client.readFile(workspaceId, path)
    if (!result.ok) {
      setTabs(current => current.filter(tab => tab.id !== id))
      setActiveId(current => current === id ? null : current)
      setFileError(result)
      return
    }
    setFileError(null)
    setTabs(current => current.map(tab => (
      tab.id === id ? { ...tab, ignored: result.value.ignored === true } : tab
    )))
    setBuffers(current => current[path] !== undefined ? current : ({
      ...current,
      [path]: { path, original: result.value.content, draft: result.value.content, language: result.value.language },
    }))
  }, [client, workspaceId])

  const openDiff = (path: string, staged: boolean): void => {
    patchWorkbenchChrome({ editorOpen: true })
    const id = diffTabId(path, staged)
    setSelectedDiff({ path, staged })
    setTabs((current) => current.some(tab => tab.id === id)
      ? current
      : [...current, { id, kind: 'diff', path, title: fileName(path), staged }])
    setActiveId(id)
  }

  const openCommitDiff = (hash: string, path: string): void => {
    patchWorkbenchChrome({ editorOpen: true })
    const id = commitDiffTabId(hash, path)
    setTabs((current) => current.some(tab => tab.id === id)
      ? current
      : [...current, { id, kind: 'commitDiff', path, title: fileName(path), hash }])
    setActiveId(id)
  }

  /** Keep open editor tabs and buffers in sync when a file or folder is renamed/moved. */
  const renamePath = (from: string, to: string): void => {
    if (from === to) return
    setTabs(current => current.map(tab => {
      if (tab.kind === 'terminal') return tab
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
        if (tab.kind === 'terminal') return true
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

  /** Alt+J or the + menu: open a fresh, isolated terminal tab and switch to it. */
  const openNewTerminal = useCallback((): void => {
    patchWorkbenchChrome({ editorOpen: true })
    const tab = nextTerminalTab(tabsRef.current)
    setTabs(current => [...current, tab])
    setActiveId(tab.id)
  }, [])

  useEffect(() => {
    // Global within the workbench: works whether focus is in the terminal,
    // the tab bar, the editor, or the side panel. xterm never sees Alt+J.
    const onKey = (event: KeyboardEvent): void => {
      if (!isTermNewTabHotkey(event)) return
      event.preventDefault()
      event.stopPropagation()
      openNewTerminal()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [openNewTerminal])

  const closeTab = (id: string): void => {
    closeTabs([id])
  }

  const closeTabs = (ids: string[]): void => {
    const closable = ids.filter(id => id !== TERMINAL_TAB_ID)
    if (closable.length === 0) return
    if (workspaceId !== undefined) {
      for (const id of closable) {
        if (id.startsWith('terminal:')) void client.closeTerm(workspaceId, termIdFromTabId(id))
      }
    }
    const closing = new Set(closable)
    // Drop the AI-open marks for closed tabs outside the updater: React may
    // run updater functions more than once, and side effects belong here.
    setAiTermIds(ids => ids.filter(id => !closing.has(id)))
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

  let panels: ReturnType<typeof createPortal> | null = null
  try {
    panels = split && host !== null ? createPortal(
    <>
      {chatOpen ? null : (
        <div className={railCss.rail} data-edge="start" data-git-ide-panel="rail-chat">
          <IconButton label={t('ide.showChat')} onClick={() => { patchWorkbenchChrome({ chatOpen: true }) }}>
            <IconChat />
          </IconButton>
        </div>
      )}
      {editorOpen ? (
        <EditorPane
          client={client}
          workspaceId={workspaceId}
          workspaceTitle={workspace?.title}
          tabs={tabs}
          activeId={activeId}
          buffers={buffers}
          onOpenFile={(path) => { void openFile(path) }}
          onActivate={setActiveId}
          onClose={closeTab}
          onCloseMany={closeTabs}
          onDraft={(path, draft) => {
            setBuffers(current => current[path] === undefined ? current : { ...current, [path]: { ...current[path]!, draft } })
          }}
          onSaved={(path, content) => {
            setBuffers(current => current[path] === undefined
              ? current
              : { ...current, [path]: { ...current[path]!, original: content, draft: content } })
          }}
          onCollapse={() => { patchWorkbenchChrome({ editorOpen: false }) }}
          notice={fileError}
          termSeed={termSeed}
          editorMode={editorMode}
          onNewTerminal={openNewTerminal}
          aiTermIds={aiTermIds}
          onAiModeChange={(tabId, open) => {
            setAiTermIds((current) => {
              const has = current.includes(tabId)
              if (open && !has) return [...current, tabId]
              if (!open && has) return current.filter(id => id !== tabId)
              return current
            })
          }}
          onCreateFile={async (path) => {
            if (workspaceId === undefined) return { ok: false, code: 'NO_WORKSPACE', messageZh: t('editor.addFileNoWorkspace'), hintZh: '' }
            const existing = await client.readFile(workspaceId, path)
            if (existing.ok) {
              await openFile(path)
              return null
            }
            if (existing.code !== 'FS_NOT_FOUND') return existing
            const created = await client.writeFile(workspaceId, path, '')
            if (!created.ok) return created
            await openFile(path)
            return null
          }}
          leadingSash={chatOpen ? (
            <ColSash
              label={t('ide.resizeChat')}
              active={dragging === 'chat'}
              onPointerDown={(event) => { beginResize('chat', event) }}
              onReset={resetChatWidth}
            />
          ) : null}
          t={t}
        />
      ) : (
        <div className={railCss.rail} data-git-ide-panel="rail-editor">
          <IconButton label={t('ide.showEditor')} onClick={() => { patchWorkbenchChrome({ editorOpen: true }) }}>
            <IconEditor />
          </IconButton>
        </div>
      )}
      {sideOpen ? (
        <SideDock
          client={client}
          workspaceId={workspaceId}
          workspaceTitle={workspace?.title}
          sessionId={sessionId}
          running={running}
          useProjection={props.useProjection}
          activePath={tabs.find(tab => tab.id === activeId)?.path}
          selected={selectedDiff}
          tab={sideTab}
          onTab={setSideTab}
          onOpenFile={(path) => { void openFile(path) }}
          onOpenDiff={openDiff}
          onOpenCommitDiff={openCommitDiff}
          onRenamed={renamePath}
          onDeleted={deletePath}
          onCollapse={() => { patchWorkbenchChrome({ sideOpen: false }) }}
          leadingSash={
            <ColSash
              label={t('ide.resizeSide')}
              active={dragging === 'side'}
              onPointerDown={(event) => { beginResize('side', event) }}
              onReset={resetSideWidth}
            />
          }
          update={updateInfo}
          onDismissUpdate={() => { setUpdateHidden(true) }}
          t={t}
        />
      ) : (
        <div className={railCss.rail} data-git-ide-panel="rail-side">
          <IconButton label={t('ide.files')} onClick={() => { patchWorkbenchChrome({ sideOpen: true }); setSideTab('files') }}>
            <IconFiles />
          </IconButton>
          <IconButton label={t('ide.git')} onClick={() => { patchWorkbenchChrome({ sideOpen: true }); setSideTab('git') }}>
            <IconGit />
          </IconButton>
          <IconButton label={t('ide.usage')} onClick={() => { patchWorkbenchChrome({ sideOpen: true }); setSideTab('usage') }}>
            <IconUsage />
          </IconButton>
        </div>
      )}
      <StatusBar
        client={client}
        workspaceId={workspaceId}
        workspacePath={workspace?.path}
        active={tabs.find(tab => tab.id === activeId) ?? null}
        plugin={pluginInfo}
        tabs={tabs}
        aiTermIds={aiTermIds}
        editorMode={editorMode}
        onEditorModeChange={changeEditorMode}
        onActivate={(id) => {
          patchWorkbenchChrome({ editorOpen: true })
          setActiveId(id)
        }}
        onPrepareUpdate={() => {
          patchWorkbenchChrome({ editorOpen: true })
          setActiveId(TERMINAL_TAB_ID)
        }}
        t={t}
      />
    </>,
    host,
  ) : null
  } catch {
    panels = null
  }

  return panels
}