import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitFail } from '../../shared/types.ts'
import { ColSash } from './ColSash.tsx'
import {
  CHAT_MIN, CHAT_RATIO, CHAT_W_KEY, EDITOR_MIN, RAIL_W,
  SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_W_KEY,
  clamp, clampLayout, readPx, writePx,
} from './column-layout.ts'
import { EditorPane } from './EditorPane.tsx'
import { IconButton } from './IconButton.tsx'
import { IconChat, IconEditor, IconFiles, IconGit, IconLayout } from './icons.tsx'
import { ensureIdeStyles } from './ide-host.css.ts'
import railCss from './Rail.module.css'
import { SideDock, type SideTab } from './SideDock.tsx'
import type { FileBuffer, FileTab, WorkbenchInjected } from './types.ts'
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

/** Header toggle + portal: native chat stays left; editor and files/git split to the right. */
export function Workbench(props: WorkbenchProps) {
  const { client, t, useSessions, useWorkspaces } = props
  const [enabled, setEnabled] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [editorOpen, setEditorOpen] = useState(true)
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState<SideTab>('git')
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [tabs, setTabs] = useState<FileTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({})
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; staged: boolean } | null>(null)
  const [fileError, setFileError] = useState<GitFail | null>(null)
  const [chatW, setChatW] = useState(() => readPx(CHAT_W_KEY, 0))
  const [sideW, setSideW] = useState(() => readPx(SIDE_W_KEY, SIDE_DEFAULT))
  const [dragging, setDragging] = useState<null | 'chat' | 'side'>(null)
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers

  const workspace = useWorkspace(useSessions, useWorkspaces)
  const workspaceId = workspace?.workspaceId
  const running = Boolean(props.useSession?.(state => state.running))
  const pending = (props.useSession?.(state => state.pending)?.length ?? 0) as number
  const blank = Boolean(props.useSession?.(state => state.blank) && props.useSession?.(state => state.composerPhase) === 'blank')
  const split = enabled && !blank

  useEffect(() => {
    if (running || pending > 0) setChatOpen(true)
  }, [running, pending])

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
      if (target instanceof Element && target.closest('[data-composer-seat]') !== null) setChatOpen(true)
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
    setEditorOpen(true)
    const id = fileTabId(path)
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
    setBuffers(current => current[path] !== undefined ? current : ({
      ...current,
      [path]: { path, original: result.value.content, draft: result.value.content, language: result.value.language },
    }))
  }, [client, workspaceId])

  const openDiff = (path: string, staged: boolean): void => {
    setEditorOpen(true)
    const id = diffTabId(path, staged)
    setSelectedDiff({ path, staged })
    setTabs((current) => current.some(tab => tab.id === id)
      ? current
      : [...current, { id, kind: 'diff', path, title: fileName(path), staged }])
    setActiveId(id)
  }

  const closeTab = (id: string): void => {
    closeTabs([id])
  }

  const closeTabs = (ids: string[]): void => {
    if (ids.length === 0) return
    setTabs((current) => {
      const closing = new Set(ids)
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
        return next[index]?.id ?? next[index - 1]?.id ?? null
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
          <IconButton label={t('ide.showChat')} onClick={() => { setChatOpen(true) }}>
            <IconChat />
          </IconButton>
        </div>
      )}
      {editorOpen ? (
        <EditorPane
          client={client}
          workspaceId={workspaceId}
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
          onCollapse={() => { setEditorOpen(false) }}
          notice={fileError}
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
          <IconButton label={t('ide.showEditor')} onClick={() => { setEditorOpen(true) }}>
            <IconEditor />
          </IconButton>
        </div>
      )}
      {sideOpen ? (
        <SideDock
          client={client}
          workspaceId={workspaceId}
          workspaceTitle={workspace?.title}
          activePath={tabs.find(tab => tab.id === activeId)?.path}
          selected={selectedDiff}
          tab={sideTab}
          onTab={setSideTab}
          onOpenFile={(path) => { void openFile(path) }}
          onOpenDiff={openDiff}
          onCollapse={() => { setSideOpen(false) }}
          leadingSash={
            <ColSash
              label={t('ide.resizeSide')}
              active={dragging === 'side'}
              onPointerDown={(event) => { beginResize('side', event) }}
              onReset={resetSideWidth}
            />
          }
          t={t}
        />
      ) : (
        <div className={railCss.rail} data-git-ide-panel="rail-side">
          <IconButton label={t('ide.files')} onClick={() => { setSideOpen(true); setSideTab('files') }}>
            <IconFiles />
          </IconButton>
          <IconButton label={t('ide.git')} onClick={() => { setSideOpen(true); setSideTab('git') }}>
            <IconGit />
          </IconButton>
        </div>
      )}
    </>,
    host,
  ) : null
  } catch {
    panels = null
  }

  return (
    <div className={css.host}>
      <button
        type="button"
        className={css.toggle}
        data-active={enabled || undefined}
        title={t('ide.toggle')}
        aria-label={t('ide.toggle')}
        aria-pressed={enabled}
        onClick={() => { setEnabled(value => !value) }}
      >
        <IconLayout />
        <span>{t('ide.toggleLabel')}</span>
      </button>
      {chatOpen ? null : (
        <IconButton label={t('ide.showChat')} onClick={() => { setChatOpen(true) }}>
          <IconChat />
        </IconButton>
      )}
      {panels}
    </div>
  )
}
