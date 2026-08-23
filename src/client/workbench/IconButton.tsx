import type { ButtonHTMLAttributes, ReactNode } from 'react'
import css from './IconButton.module.css'

export function IconButton({
  label, active, dense, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; dense?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`${css.btn}${dense ? ` ${css.dense}` : ''}${className !== undefined ? ` ${className}` : ''}`}
      data-active={active || undefined}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  )
}
