import { useCallback } from 'react'
import type { BrowserElSnapshot } from '../../../shared/browser-el.ts'
import { BrowserView } from '../BrowserView.tsx'
import type { Translate } from '../types.ts'
import { PaneShell } from './PaneShell.tsx'
import { SIDEBAR_BROWSER_TAB_ID } from './ids.ts'

export type BrowserPaneProps = {
  t: Translate
}

/** Embedded browser hosted in the official right Sidebar. */
export function BrowserPane({ t }: BrowserPaneProps) {
  const onTitle = useCallback((_title: string, _url: string): void => {
    /* Chip title stays the type label; the address bar shows the live URL. */
  }, [])
  const onPick = useCallback((_snapshot: BrowserElSnapshot): boolean => false, [])
  return (
    <PaneShell>
      <BrowserView
        tabId={SIDEBAR_BROWSER_TAB_ID}
        onTitle={onTitle}
        onOpenDevtools={() => { /* DevTools stays on the workbench bottom/side dock for now. */ }}
        onPick={onPick}
        t={t}
      />
    </PaneShell>
  )
}
