import type { ButtonHTMLAttributes, ReactNode } from 'react'
import css from './IconButton.module.css'

export function IconButton({
  label, active, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={css.btn}
      data-active={active || undefined}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  )
}
