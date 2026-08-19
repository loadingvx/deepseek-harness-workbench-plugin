import type { PointerEventHandler } from 'react'
import css from './ColSash.module.css'

function Sash({
  label, active, orientation, onPointerDown, onReset,
}: {
  label: string
  active?: boolean
  orientation: 'vertical' | 'horizontal'
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onReset?: () => void
}) {
  return (
    <button
      type="button"
      className={css.sash}
      data-active={active || undefined}
      data-orientation={orientation}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onDoubleClick={() => { onReset?.() }}
    />
  )
}

export function ColSash({
  label, active, onPointerDown, onReset,
}: {
  label: string
  active?: boolean
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onReset?: () => void
}) {
  return (
    <Sash
      label={label}
      active={active}
      orientation="vertical"
      onPointerDown={onPointerDown}
      onReset={onReset}
    />
  )
}

export function RowSash({
  label, active, onPointerDown, onReset,
}: {
  label: string
  active?: boolean
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onReset?: () => void
}) {
  return (
    <Sash
      label={label}
      active={active}
      orientation="horizontal"
      onPointerDown={onPointerDown}
      onReset={onReset}
    />
  )
}
