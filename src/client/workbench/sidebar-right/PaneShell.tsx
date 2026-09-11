import type { CSSProperties, ReactNode } from 'react'
import css from './PaneShell.module.css'

const rootStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

/** Full-height shell so SideDock panels fill an official sidebar pane. */
export function PaneShell({ children }: { children: ReactNode }) {
  return (
    <div className={css.root} style={rootStyle} data-workbench-sidebar-pane="">
      {children}
    </div>
  )
}
