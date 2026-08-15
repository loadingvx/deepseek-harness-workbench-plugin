import type { PointerEventHandler } from 'react'
import css from './ColSash.module.css'

export function ColSash({
  label, active, onPointerDown, onReset,
}: {
  label: string
  active?: boolean
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onReset?: () => void
}) {
  return (
    <button
      type="button"
      className={css.sash}
      data-active={active || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onDoubleClick={() => { onReset?.() }}
    />
  )
}
