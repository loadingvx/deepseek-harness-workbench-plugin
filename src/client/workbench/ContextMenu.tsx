import { useLayoutEffect, useRef, type ReactNode } from 'react'
import css from './ContextMenu.module.css'

export type ContextMenuEntry =
  | { kind: 'item'; id: string; icon?: ReactNode; label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick?: () => void }
  | { kind: 'sep' }

/**
 * Generic right-click menu: fixed-position floating layer with a full-screen
 * backdrop, viewport clamping, Esc / backdrop close, and optional danger items.
 * The caller owns the open state (usually `{ x, y } | null`) and renders this
 * component only while open.
 */
export function ContextMenu({
  x,
  y,
  items,
  ariaLabel,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuEntry[]
  ariaLabel: string
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const node = menuRef.current
    if (node === null) return
    const box = node.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8))
    node.style.left = `${left}px`
    node.style.top = `${top}px`
  }, [x, y, items])

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
      <div className={css.backdrop} onMouseDown={onClose} />
      <div
        ref={menuRef}
        className={css.menu}
        role="menu"
        aria-label={ariaLabel}
        style={{ left: x, top: y }}
        onMouseDown={(event) => { event.stopPropagation() }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {items.map((entry, index) => {
          if (entry.kind === 'sep') {
            return <div key={'sep-' + index} className={css.sep} />
          }
          const item = entry
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={css.item}
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              title={item.hint ?? item.label}
              onClick={() => {
                onClose()
                item.onClick?.()
              }}
            >
              {item.icon !== undefined ? <span className={css.icon}>{item.icon}</span> : null}
              <span className={css.label}>
                <span className={css.labelText}>{item.label}</span>
                {item.hint !== undefined && item.disabled ? <span className={css.itemHint}>{item.hint}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
