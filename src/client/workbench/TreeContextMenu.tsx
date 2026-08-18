import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ExternalEditorId, ExternalEditorInfo } from '../../shared/types.ts'
import {
  IconCopy, IconCut, IconEditor, IconExternal, IconFilePlus, IconFiles, IconFolderPlus,
  IconPaste, IconRename, IconReveal, IconTrash,
} from './icons.tsx'
import type { Translate } from './types.ts'
import css from './FileTree.module.css'

export type TreeMenuTarget =
  | { scope: 'root' }
  | { scope: 'entry'; path: string; name: string; kind: 'file' | 'directory' }

export function TreeContextMenu({
  x, y, target, canPaste, pasteHint, editors, editorsReady, revealLabel, busy, t,
  onOpen, onReveal, onCut, onCopy, onPaste, onNewFile, onNewFolder, onRename, onDelete, onOpenExternal, onClose,
  onCopyRelPath, onCopyAbsPath,
}: {
  x: number
  y: number
  target: TreeMenuTarget
  canPaste: boolean
  pasteHint: string
  editors: ExternalEditorInfo[]
  editorsReady: boolean
  revealLabel: string
  busy: boolean
  t: Translate
  onOpen: () => void
  onReveal: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  onOpenExternal: (app: ExternalEditorId) => void
  onClose: () => void
  onCopyRelPath: () => void
  onCopyAbsPath: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const entry = target.scope === 'entry' ? target : null
  const disabled = busy

  useLayoutEffect(() => {
    const node = menuRef.current
    if (node === null) return
    const box = node.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8))
    node.style.left = `${left}px`
    node.style.top = `${top}px`
  }, [x, y, editorsReady, editors.length, canPaste])

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  return (
    <>
      <div className={css.ctxBackdrop} onMouseDown={onClose} />
      <div
        ref={menuRef}
        className={css.ctxMenu}
        role="menu"
        aria-label={t('tree.menu')}
        style={{ left: x, top: y }}
        onMouseDown={(event) => { event.stopPropagation() }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {entry !== null ? (
          <>
            <MenuItem icon={<IconCopy />} label={t('tree.copyRelPath')} disabled={disabled} onClick={onCopyRelPath} />
            <MenuItem icon={<IconCopy />} label={t('tree.copyAbsPath')} disabled={disabled} onClick={onCopyAbsPath} />
            <div className={css.ctxSep} />
          </>
        ) : null}
        {entry !== null ? (
          <MenuItem
            icon={entry.kind === 'directory' ? <IconFiles /> : <IconEditor />}
            label={entry.kind === 'directory' ? t('tree.openFolder') : t('tree.open')}
            disabled={disabled}
            onClick={onOpen}
          />
        ) : null}
        <MenuItem icon={<IconReveal />} label={revealLabel} disabled={disabled} onClick={onReveal} />
        {editorsReady ? editors.map((item) => {
          const app = t(`tree.editor.${item.id}`) || item.label
          return (
            <MenuItem
              key={item.id}
              icon={<IconExternal />}
              label={item.available ? t('tree.openWith', { app }) : t('tree.openWithMissing', { app })}
              disabled={disabled || !item.available}
              onClick={() => { onOpenExternal(item.id) }}
            />
          )
        }) : (
          <p className={css.ctxHint}>{t('tree.loading')}</p>
        )}
        <div className={css.ctxSep} />
        {entry !== null ? (
          <>
            <MenuItem icon={<IconCut />} label={t('tree.cut')} disabled={disabled} onClick={onCut} />
            <MenuItem icon={<IconCopy />} label={t('tree.copy')} disabled={disabled} onClick={onCopy} />
          </>
        ) : null}
        <MenuItem
          icon={<IconPaste />}
          label={t('tree.paste')}
          disabled={disabled || !canPaste}
          hint={!canPaste ? pasteHint : undefined}
          onClick={onPaste}
        />
        <div className={css.ctxSep} />
        <MenuItem icon={<IconFilePlus />} label={t('tree.newFile')} disabled={disabled} onClick={onNewFile} />
        <MenuItem icon={<IconFolderPlus />} label={t('tree.newFolder')} disabled={disabled} onClick={onNewFolder} />
        {entry !== null ? (
          <>
            <div className={css.ctxSep} />
            <MenuItem icon={<IconRename />} label={t('tree.rename')} disabled={disabled} onClick={onRename} />
            <MenuItem icon={<IconTrash />} label={t('tree.delete')} disabled={disabled} danger onClick={onDelete} />
          </>
        ) : null}
      </div>
    </>
  )
}

function MenuItem({
  icon, label, hint, disabled, danger, onClick,
}: {
  icon: ReactNode
  label: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={css.ctxItem}
      data-danger={danger || undefined}
      disabled={disabled}
      title={hint ?? label}
      onClick={onClick}
    >
      <span className={css.ctxIcon}>{icon}</span>
      <span className={css.ctxLabel}>
        <span className={css.ctxLabelText}>{label}</span>
        {hint !== undefined && disabled ? <span className={css.ctxItemHint}>{hint}</span> : null}
      </span>
    </button>
  )
}
