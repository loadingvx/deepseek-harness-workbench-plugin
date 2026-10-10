import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  transferActionFor,
  transferErrorMessage,
  transferRelativePath,
  transferTargetDir,
  transferUrl,
  type EntryKind,
  type SelectedEntry,
  type TransferResult,
} from './transfer-utils.ts'
import css from './FilesTransfer.module.css'

/** The Files tab renders this into `sidebar.right.tab.files.actions` (session scope). */
type FilesTransferProps = {
  absolutePath?: string
  sessionId?: string
} & PropsLocale<'workbench'>

interface MenuState {
  path: string
  kind: EntryKind
  x: number
  y: number
}

function entryRow(target: EventTarget | null): SelectedEntry | null {
  if (!(target instanceof Element)) return null
  const row = target.closest('[data-files-entry]')
  if (row === null) return null
  const kind = row.dataset.filesEntry
  const path = row.dataset.filesPath
  if (kind !== 'file' && kind !== 'directory' && kind !== 'other') return null
  if (typeof path !== 'string' || path === '') return null
  return { path, kind }
}

/** Vertical ellipsis: the three dots at the right end of every file and folder row. */
const MORE_GLYPH = '⋮'

/** Keep the popup inside the viewport, anchored under a row control. */
function anchorMenu(rect: DOMRect, width = 180, height = 64): { x: number; y: number } {
  return {
    x: Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 4)),
    y: Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - height)),
  }
}

/**
 * Upload / download controls for the official Files tab.
 *
 * Selection is read from the Files tree itself (`data-files-entry` rows) and only ever decides where an
 * upload lands. Every file and folder row carries its size and a three-dots control at the right end;
 * the dots open the download menu, which is also what a right-click opens. Nothing about downloading
 * depends on a row being selected, so a touch device with no selection state still reaches every file.
 */
export function FilesTransfer({ absolutePath, sessionId, t }: FilesTransferProps): JSX.Element {
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingRef = useRef<{ sessionId: string; dir: string } | null>(null)
  const pointerTypeRef = useRef<string>('mouse')
  const [selected, setSelected] = useState<SelectedEntry | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<TransferResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const hasTarget = typeof absolutePath === 'string' && absolutePath !== '' && typeof sessionId === 'string' && sessionId !== ''

  const startDownload = useCallback((entry: SelectedEntry): void => {
    if (absolutePath === undefined || sessionId === undefined) return
    let url: string
    try {
      url = transferUrl(transferActionFor(entry.kind), sessionId, transferRelativePath(absolutePath, entry.path))
    } catch {
      return
    }
    // A same-origin anchor with `download` keeps the filename the host chose, including the zip name.
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ''
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }, [absolutePath, sessionId])

  /** The official Files rows carry no size, so each folder that is actually on screen is asked once. */
  const sizeCache = useRef(new Map<string, Map<string, number>>())

  /**
   * Give every visible row its right-end tail: the size (files only — the official listing reports
   * names and kinds) and the three-dots control that opens the download menu.
   */
  const decorateRows = useCallback(async (tree: Element): Promise<void> => {
    if (typeof absolutePath !== 'string' || typeof sessionId !== 'string') return
    const sized: Array<{ tail: Element; dir: string; name: string }> = []
    const missing = new Set<string>()
    for (const row of Array.from(tree.querySelectorAll('[data-files-entry][data-files-path]'))) {
      const kind = row.dataset.filesEntry
      if (kind !== 'file' && kind !== 'directory') continue
      const absolute = row.dataset.filesPath
      if (typeof absolute !== 'string') continue
      const host = row.querySelector('button') ?? row
      let rel: string
      try {
        rel = transferRelativePath(absolutePath, absolute)
      } catch {
        continue
      }
      const slash = rel.lastIndexOf('/')
      const name = slash === -1 ? rel : rel.slice(slash + 1)
      const dir = slash === -1 ? '' : rel.slice(0, slash)
      if (name === '') continue

      let tail = host.querySelector('[data-workbench-tail]')
      if (tail === null) {
        tail = document.createElement('span')
        tail.className = css.tail
        tail.dataset.workbenchTail = 'true'
        host.append(tail)
      }
      if (tail.querySelector('[data-workbench-more]') === null) {
        const more = document.createElement('button')
        more.type = 'button'
        more.className = css.more
        more.dataset.workbenchMore = 'true'
        more.setAttribute('aria-label', t('transfer.more'))
        more.title = t('transfer.more')
        more.textContent = MORE_GLYPH
        tail.append(more)
      }
      if (kind !== 'file') continue
      sized.push({ tail, dir, name })
      if (!sizeCache.current.has(dir)) missing.add(dir)
    }
    for (const dir of missing) {
      try {
        const res = await fetch(transferUrl('sizes', sessionId, dir))
        if (!res.ok) continue
        const body = await res.json() as { value?: { entries?: Array<{ name: string; size: number }> } }
        const sizes = new Map<string, number>()
        for (const item of body.value?.entries ?? []) sizes.set(item.name, item.size)
        sizeCache.current.set(dir, sizes)
      } catch {
        // A row without a size label is better than a row that never appears.
      }
    }
    for (const { tail, dir, name } of sized) {
      const dots = tail.querySelector('[data-workbench-more]')
      const size = sizeCache.current.get(dir)?.get(name)
      const label = tail.querySelector('[data-workbench-size]')
      if (size === undefined) {
        if (label !== null) label.remove()
        continue
      }
      const text = formatBytes(size)
      if (label instanceof HTMLElement) {
        if (label.textContent !== text) label.textContent = text
        continue
      }
      const span = document.createElement('span')
      span.className = css.size
      span.dataset.workbenchSize = 'true'
      span.textContent = text
      if (dots === null) tail.append(span)
      else tail.insertBefore(span, dots)
    }
  }, [absolutePath, sessionId, t])

  useEffect(() => {
    const wrap = wrapRef.current
    const tree = wrap === null ? null : wrap.closest('[data-files-state="tree"]')
    if (tree === null || tree === undefined) return () => {}
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      const dots = target instanceof Element ? target.closest('[data-workbench-more]') : null
      if (dots !== null) {
        const row = entryRow(dots)
        if (row === null || row.kind === 'other') return
        // The row control is not the row: opening the menu must not open the file or fold the folder.
        event.preventDefault()
        event.stopPropagation()
        const at = anchorMenu(dots.getBoundingClientRect())
        setSelected(row)
        setMenu({ path: row.path, kind: row.kind, x: at.x, y: at.y })
        return
      }
      setSelected(entryRow(event.target))
      setMenu(null)
    }
    const onPointerDown = (event: PointerEvent): void => {
      pointerTypeRef.current = event.pointerType
    }
    const onContext = (event: MouseEvent): void => {
      const row = entryRow(event.target)
      if (row === null || row.kind === 'other') return
      // The row the user actually acted on is the target, selection or not.
      setSelected(row)
      // A touch long press is not a request for a menu; the row dots are the way in there.
      if (pointerTypeRef.current === 'touch') return
      event.preventDefault()
      setMenu({
        path: row.path,
        kind: row.kind,
        x: Math.max(4, Math.min(event.clientX, window.innerWidth - 184)),
        y: Math.max(4, Math.min(event.clientY, window.innerHeight - 64)),
      })
    }
    let timer: number | undefined
    const schedule = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void decorateRows(tree) }, 120)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(tree, { childList: true, subtree: true })
    tree.addEventListener('click', onClick)
    tree.addEventListener('contextmenu', onContext)
    tree.addEventListener('pointerdown', onPointerDown)
    schedule()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      observer.disconnect()
      tree.removeEventListener('click', onClick)
      tree.removeEventListener('contextmenu', onContext)
      tree.removeEventListener('pointerdown', onPointerDown)
    }
  }, [absolutePath, sessionId, decorateRows])

  useEffect(() => {
    if (menu === null) return () => {}
    const onPointerDown = (event: PointerEvent): void => {
      // A press inside the menu belongs to the menu item; closing here would unmount it before its click.
      const target = event.target
      if (target instanceof Element && target.closest('[data-workbench-download-menu]') !== null) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const patchResult = useCallback((index: number, patch: Partial<TransferResult>): void => {
    setResults((previous) => previous.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }, [])

  const uploadOne = useCallback((file: File, target: { sessionId: string; dir: string }, index: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const path = target.dir === '' ? file.name : `${target.dir}/${file.name}`
      xhr.open('POST', transferUrl('upload', target.sessionId, path))
      xhr.setRequestHeader('content-type', 'application/octet-stream')
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) patchResult(index, { percent: Math.round((event.loaded / event.total) * 100) })
      }
      xhr.onload = (): void => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
          return
        }
        let body: unknown
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          body = undefined
        }
        reject(new Error(transferErrorMessage(xhr.status, body, t)))
      }
      xhr.onerror = (): void => reject(new Error(t('transfer.network')))
      xhr.onabort = (): void => reject(new Error(t('transfer.cancelled')))
      xhr.send(file)
    }), [patchResult, t])

  const onPick = useCallback(async (files: File[]): Promise<void> => {
    const target = pendingRef.current
    if (target === null || files.length === 0) return
    setBusy(true)
    setShowResults(true)
    setResults(files.map((file) => ({ name: file.name, state: 'queued', percent: 0 })))
    let uploaded = 0
    for (let index = 0; index < files.length; index++) {
      const file = files[index] as File
      if (file.size > MAX_UPLOAD_BYTES) {
        patchResult(index, { state: 'error', percent: 0, message: t('transfer.tooLarge') })
        continue
      }
      patchResult(index, { state: 'uploading', percent: 0 })
      try {
        await uploadOne(file, target, index)
        uploaded += 1
        patchResult(index, { state: 'done', percent: 100 })
      } catch (error) {
        patchResult(index, { state: 'error', percent: 0, message: error instanceof Error ? error.message : String(error) })
      }
    }
    setBusy(false)
    if (uploaded > 0) {
      // Fresh sizes for the rows the upload just changed, then nudge the tree so they show up.
      sizeCache.current.clear()
      const scope = wrapRef.current?.closest('[data-sidebar-right-session]') ?? document
      const reload = scope instanceof Document ? scope : (scope as Element)
      const button = reload.querySelector('[data-files-reload]')
      if (button instanceof HTMLElement) button.click()
    }
  }, [patchResult, t, uploadOne])

  return (
    <span ref={wrapRef} className={css.bar}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className={css.file}
        onChange={(event) => {
          const list = event.target.files
          void onPick(list === null ? [] : Array.from(list))
          event.target.value = ''
        }}
      />
      <button
        type="button"
        className={css.tool}
        disabled={!hasTarget || busy}
        title={t('transfer.uploadHint')}
        data-workbench-upload="true"
        onClick={() => {
          if (absolutePath === undefined || sessionId === undefined) return
          let dir = ''
          try {
            dir = transferTargetDir(absolutePath, selected)
          } catch {
            dir = ''
          }
          pendingRef.current = { sessionId, dir }
          inputRef.current?.click()
        }}
      >
        {busy ? t('transfer.uploading') : t('transfer.upload')}
      </button>
      {results.length > 0 ? (
        <button type="button" className={css.tool} onClick={() => setShowResults((value) => !value)}>
          {t('transfer.results')}
        </button>
      ) : null}
      {showResults && results.length > 0 ? (
        <span className={css.panel} role="status" data-workbench-transfer-status="true">
          {results.map((item, index) => (
            <span className={css.row} key={`${item.name}-${index}`}>
              <span className={css.name}>{item.name}</span>
              <span className={item.state === 'error' ? `${css.state} ${css.stateError}` : item.state === 'done' ? `${css.state} ${css.stateDone}` : css.state}>
                {item.state === 'queued' ? t('transfer.queued')
                  : item.state === 'uploading' ? `${item.percent}%`
                  : item.state === 'done' ? t('transfer.uploaded')
                  : item.message ?? t('transfer.failed')}
              </span>
            </span>
          ))}
          <button type="button" className={css.tool} onClick={() => setShowResults(false)}>
            {t('transfer.close')}
          </button>
        </span>
      ) : null}
      {menu !== null && hasTarget ? createPortal(
        <div className={css.menu} role="menu" style={{ left: menu.x, top: menu.y }} data-workbench-download-menu="true">
          <button
            type="button"
            className={css.menuItem}
            role="menuitem"
            data-workbench-download="true"
            onClick={() => {
              startDownload({ path: menu.path, kind: menu.kind })
              setMenu(null)
            }}
          >
            {menu.kind === 'directory' ? t('transfer.downloadDir') : t('transfer.downloadFile')}
          </button>
        </div>,
        document.body,
      ) : null}
    </span>
  )
}
