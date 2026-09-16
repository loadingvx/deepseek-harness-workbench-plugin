/**
 * Full-viewport dialog layer, aligned with the host Modal / Settings mask:
 * portal to document.body, --dsw-alias-bg-mask-1 + --dsw-mask-blur, z-index 1000.
 * Ancestor stacking contexts cannot leave sticky chrome above the mask.
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './DialogOverlay.module.css'

export function DialogOverlay({
  onClose,
  children,
}: {
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  return createPortal(
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      {children}
    </div>,
    document.body,
  )
}
