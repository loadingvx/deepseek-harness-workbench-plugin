import type { GitClient } from '../../api.ts'
import { UsagePanel } from '../UsagePanel.tsx'
import type { Translate } from '../types.ts'
import { PaneShell } from './PaneShell.tsx'

export type UsagePaneProps = {
  client: GitClient
  t: Translate
  sessionId: string
  useSession?: <T>(selector: (state: { running?: boolean }) => T) => T
  useProjection?: (key: string, selector?: (value: unknown) => unknown) => unknown
}

export function UsagePane({ client, t, sessionId, useSession, useProjection }: UsagePaneProps) {
  const running = useSession?.(state => state.running === true) ?? false
  return (
    <PaneShell>
      <UsagePanel
        client={client}
        sessionId={sessionId}
        running={running}
        useProjection={useProjection}
        t={t}
      />
    </PaneShell>
  )
}
