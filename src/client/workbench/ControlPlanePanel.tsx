/**
 * Agent Control Plane — 执行轨迹 + 能力配置（轨迹式纵向列表）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitClient } from '../api.ts'
import { emptyKnobs, type ControlPlaneSnapshot } from '../../shared/control-plane.ts'
import { buildCapabilitiesViewModel } from './control-plane-capabilities.ts'
import { ControlPlaneCapabilitiesView } from './ControlPlaneCapabilitiesView.tsx'
import { AgentAssetsView } from './AgentAssetsView.tsx'
import type { Translate } from './types.ts'
import { TrajectoryView } from './TrajectoryView.tsx'
import css from './ControlPlanePanel.module.css'

export type ControlPlaneUseSession = <T>(selector: (state: {
  nodes?: readonly unknown[]
  partial?: unknown
  running?: boolean
  runningCalls?: readonly unknown[]
}) => T) => T

export interface ControlPlanePanelProps {
  client: GitClient
  workspaceId?: string
  sessionId?: string
  useSession?: ControlPlaneUseSession
  t: Translate
}

const PANEL_TAB_KEY = 'dsh-control-plane-tab'

type PanelTab = 'trajectory' | 'topology' | 'skills' | 'rules'

function readPanelTab(): PanelTab {
  try {
    const saved = sessionStorage.getItem(PANEL_TAB_KEY)
    if (saved === 'topology' || saved === 'skills' || saved === 'rules' || saved === 'trajectory') return saved
    return 'trajectory'
  } catch {
    return 'trajectory'
  }
}

function writePanelTab(tab: PanelTab): void {
  try { sessionStorage.setItem(PANEL_TAB_KEY, tab) } catch { /* ignore */ }
}

export function ControlPlanePanel({ client, workspaceId, sessionId, useSession, t }: ControlPlanePanelProps) {
  const [panelTab, setPanelTab] = useState<PanelTab>(readPanelTab)
  const [assetReload, setAssetReload] = useState(0)
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const result = await client.controlPlane(sessionId)
    if (!result.ok) {
      setLoadError(result.messageZh || t('controlPlane.loadFail'))
      return
    }
    setLoadError(null)
    setSnapshot({
      ...result.value,
      agentKnobs: result.value.agentKnobs ?? {},
    })
  }, [client, sessionId, t])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => { void reload() }, 4_000)
    return () => { window.clearInterval(timer) }
  }, [reload])

  const headerStats = useMemo(() => {
    if (snapshot === null) return null
    const view = buildCapabilitiesViewModel(snapshot)
    const focus = view.focus
    if (focus === null) return null
    const tools = view.nodes.filter(
      n => n.kind === 'tool' && n.agentId === focus.agent.agentId,
    ).length
    const sections = view.nodes.filter(
      n => n.kind === 'prompt-section' && n.agentId === focus.agent.agentId,
    ).length
    const subagents = focus.subagents.length
    return { tools, sections, subagents, plugins: view.plugins.length }
  }, [snapshot])

  const onPatch = useCallback(async (agentId: string, patch: Record<string, unknown>): Promise<void> => {
    if (agentId === '') {
      setError(t('controlPlane.needSession'))
      return
    }
    setBusy(true)
    setError(null)
    const result = await client.patchControlPlaneKnobs(agentId, patch)
    setBusy(false)
    if (!result.ok) {
      setError(result.messageZh || t('controlPlane.patchFail'))
      return
    }
    setSnapshot({
      ...result.value.snapshot,
      agentKnobs: result.value.snapshot.agentKnobs ?? {},
    })
  }, [client, t])

  const resetAll = useCallback(async (): Promise<void> => {
    const target = sessionId
    if (target === undefined || target === '') return
    setBusy(true)
    setError(null)
    const result = await client.patchControlPlaneKnobs(target, { reset: true })
    setBusy(false)
    if (!result.ok) {
      setError(result.messageZh || t('controlPlane.patchFail'))
      return
    }
    setSnapshot({
      ...result.value.snapshot,
      agentKnobs: result.value.snapshot.agentKnobs ?? {},
    })
  }, [client, sessionId, t])

  const focusKnobs = snapshot !== null && sessionId !== undefined
    ? (snapshot.agentKnobs?.[sessionId] ?? snapshot.knobs)
    : emptyKnobs()

  const activeOverlay = focusKnobs.modelOverride !== null
    || focusKnobs.toolDeny.length > 0
    || focusKnobs.promptAppend.trim() !== ''
    || focusKnobs.preStepReject

  const tabHint = panelTab === 'trajectory'
    ? t('controlPlane.trajHint')
    : panelTab === 'topology'
      ? t('controlPlane.topoHint')
      : panelTab === 'skills'
        ? t('controlPlane.skillsHint')
        : t('controlPlane.rulesHint')

  const selectTab = (tab: PanelTab): void => {
    setPanelTab(tab)
    writePanelTab(tab)
  }

  const onRefresh = (): void => {
    if (panelTab === 'skills' || panelTab === 'rules') {
      setAssetReload(n => n + 1)
      return
    }
    void reload()
  }

  return (
    <div className={css.root} data-git-ide-panel="control-plane">
      <header className={css.head}>
        <div className={css.headText}>
          <h1 className={css.title}>{t('controlPlane.title')}</h1>
          <p className={css.subtitle}>{tabHint}</p>
          <div className={css.panelTabs}>
            <button
              type="button"
              className={css.panelTab}
              data-active={panelTab === 'trajectory' || undefined}
              aria-pressed={panelTab === 'trajectory'}
              onClick={() => selectTab('trajectory')}
            >
              {t('controlPlane.tab.trajectory')}
            </button>
            <button
              type="button"
              className={css.panelTab}
              data-active={panelTab === 'topology' || undefined}
              aria-pressed={panelTab === 'topology'}
              onClick={() => selectTab('topology')}
            >
              {t('controlPlane.tab.topology')}
            </button>
            <button
              type="button"
              className={css.panelTab}
              data-active={panelTab === 'skills' || undefined}
              aria-pressed={panelTab === 'skills'}
              onClick={() => selectTab('skills')}
            >
              {t('controlPlane.tab.skills')}
            </button>
            <button
              type="button"
              className={css.panelTab}
              data-active={panelTab === 'rules' || undefined}
              aria-pressed={panelTab === 'rules'}
              onClick={() => selectTab('rules')}
            >
              {t('controlPlane.tab.rules')}
            </button>
          </div>
        </div>
        {headerStats !== null && panelTab === 'topology' ? (
          <div className={css.headStats} aria-label={t('controlPlane.graphLabel')}>
            <span className={css.headStat} data-kind="tools">
              {t('controlPlane.stat.tools', { count: headerStats.tools })}
            </span>
            <span className={css.headStat} data-kind="prompt">
              {t('controlPlane.stat.prompt', { count: headerStats.sections })}
            </span>
            {headerStats.subagents > 0 ? (
              <span className={css.headStat} data-kind="agent">
                {t('controlPlane.stat.subagents', { count: headerStats.subagents })}
              </span>
            ) : null}
            <span className={css.headStat} data-kind="plugin">
              {t('controlPlane.stat.plugins', { count: headerStats.plugins })}
            </span>
          </div>
        ) : null}
        <div className={css.headActions}>
          {activeOverlay && panelTab === 'topology' ? (
            <button type="button" className={css.btnGhost} disabled={busy} onClick={() => { void resetAll() }}>
              {t('controlPlane.reset')}
            </button>
          ) : null}
          <button type="button" className={css.btn} disabled={busy} onClick={onRefresh}>
            {t('controlPlane.refresh')}
          </button>
        </div>
      </header>

      <div className={css.stage} data-tab={panelTab}>
        {panelTab === 'trajectory' ? (
          <TrajectoryView client={client} sessionId={sessionId} useSession={useSession} t={t} />
        ) : panelTab === 'skills' ? (
          <AgentAssetsView
            client={client}
            workspaceId={workspaceId}
            family="skill"
            reloadToken={assetReload}
            t={t}
          />
        ) : panelTab === 'rules' ? (
          <AgentAssetsView
            client={client}
            workspaceId={workspaceId}
            family="rule"
            reloadToken={assetReload}
            t={t}
          />
        ) : snapshot !== null ? (
          <ControlPlaneCapabilitiesView
            snapshot={snapshot}
            busy={busy}
            error={error}
            loadError={loadError}
            onPatch={(agentId, patch) => { void onPatch(agentId, patch) }}
            t={t}
          />
        ) : loadError ? (
          <p className={css.error} role="alert">{loadError}</p>
        ) : (
          <p className={css.detailEmpty}>{t('controlPlane.empty')}</p>
        )}
      </div>
    </div>
  )
}
