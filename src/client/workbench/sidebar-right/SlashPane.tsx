import { SlashPanel } from '../../ultra-slash/SlashPanel.tsx'
import { PaneShell } from './PaneShell.tsx'

/** Plugin slash-command manager in the official right Sidebar. */
export function SlashPane() {
  return (
    <PaneShell>
      <SlashPanel />
    </PaneShell>
  )
}
