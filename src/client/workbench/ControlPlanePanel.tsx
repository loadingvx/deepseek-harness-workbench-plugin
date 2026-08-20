/**
 * Agent Control Plane — structure topology + git-graph curved strokes + drawer knobs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitClient } from '../api.ts'
import {
  emptyKnobs,
  type ControlPlaneKnobs,
  type ControlPlaneNode,
  type ControlPlaneSnapshot,
} from '../../shared/control-plane.ts'
import { edgeColor, JUNCTION_R, layoutControlPlaneTopology } from './control-plane-topology.ts'
import type { Translate } from './types.ts'
import css from './ControlPlanePanel.module.css'

export interface ControlPlanePanelProps {
  client: GitClient
  sessionId?: string
  t: Translate
}

function kindLabel(kind: ControlPlaneNode['kind'], t: Translate): string {
  switch (kind) {
    case 'agent': return t('controlPlane.kind.agent')
    case 'llm': return t('controlPlane.kind.llm')
    case 'tools': return t('controlPlane.kind.tools')
    case 'tool': return t('controlPlane.kind.tool')
    case 'prompt': return t('controlPlane.kind.prompt')
    case 'prompt-section': return t('controlPlane.kind.promptSection')
    case 'memory': return t('controlPlane.kind.memory')
    case 'inbox': return t('controlPlane.kind.inbox')
    case 'subagent': return t('controlPlane.kind.subagent')
    case 'ambient': return t('controlPlane.kind.ambient')
    case 'plugin': return t('controlPlane.kind.plugin')
    default: return kind
  }
}

function shortTitle(node: ControlPlaneNode, t: Translate): string {
  if (node.kind === 'agent' || node.kind === 'subagent') {
    if (node.current) return node.kind === 'subagent' ? 'Sub · HEAD' : 'Agent · HEAD'
    return node.kind === 'subagent' ? 'Subagent' : 'Agent'
  }
  return kindLabel(node.kind, t)
}

function knobsFor(
  snapshot: ControlPlaneSnapshot,
  agentId: string | undefined,
): ControlPlaneKnobs {
  if (agentId !== undefined && snapshot.agentKnobs?.[agentId] !== undefined) {
    return snapshot.agentKnobs[agentId]!
  }
  if (agentId !== undefined && agentId === snapshot.sessionId) return snapshot.knobs
  return emptyKnobs()
}

function Drawer({
  node,
  knobs,
  snapshot,
  busy,
  error,
  onClose,
  onPatch,
  t,
}: {
  node: ControlPlaneNode
  knobs: ControlPlaneKnobs
  snapshot: ControlPlaneSnapshot
  busy: boolean
  error: string | null
  onClose: () => void
  onPatch: (agentId: string, patch: Record<string, unknown>) => void
  t: Translate
}) {
  const [promptDraft, setPromptDraft] = useState(knobs.promptAppend)
  useEffect(() => { setPromptDraft(knobs.promptAppend) }, [knobs.promptAppend, snapshot.generatedAt, node.id])

  const agentId = node.agentId
  const canPatch = typeof agentId === 'string' && agentId !== ''
  const locked = !node.adjustable || !canPatch
  const denied = new Set(knobs.toolDeny)
  const childTools = snapshot.nodes.filter(item => (
    item.kind === 'tool' && item.agentId === node.agentId
    && (node.kind === 'tools' || node.kind === 'tool')
  ))
  const childSections = node.kind === 'prompt'
    ? snapshot.nodes.filter(item => item.kind === 'prompt-section' && item.parentId === node.id)
    : []
  const childPlugins = node.kind === 'ambient'
    ? snapshot.nodes.filter(item => item.kind === 'plugin' && item.parentId === node.id)
    : []

  const apply = (patch: Record<string, unknown>): void => {
    if (!canPatch) return
    onPatch(agentId, patch)
  }

  return (
    <aside className={css.drawer} role="dialog" aria-label={t('controlPlane.drawerTitle')}>
      <header className={css.drawerHead}>
        <div className={css.drawerHeadText}>
          <span className={css.drawerKind}>{kindLabel(node.kind, t)}</span>
          <h2 className={css.drawerTitle}>{node.label}</h2>
        </div>
        <button type="button" className={css.drawerClose} onClick={onClose} aria-label={t('controlPlane.drawerClose')}>
          ×
        </button>
      </header>

      <div className={css.drawerBody}>
        {node.detail ? <p className={css.detailLine}>{node.detail}</p> : null}
        <div className={css.drawerFlags}>
          {node.adjustable
            ? <span className={css.pill} data-tone="ok">{t('controlPlane.adjustable')}</span>
            : <span className={css.pill} data-tone="lock">{t('controlPlane.readonly')}</span>}
          {node.current ? <span className={css.pill} data-tone="head">HEAD</span> : null}
          {node.status ? <span className={css.pill} data-tone="mute">{node.status}</span> : null}
          {canPatch ? (
            <span className={css.pill} data-tone="mute">{agentId.slice(0, 10)}…</span>
          ) : null}
        </div>
        {node.lockReasonZh ? <p className={css.lockReason}>{node.lockReasonZh}</p> : null}
        {!canPatch && node.adjustable ? (
          <p className={css.lockReason}>{t('controlPlane.needSession')}</p>
        ) : null}
        {error ? <p className={css.error} role="alert">{error}</p> : null}

        {node.kind === 'tools' && childTools.length > 0 ? (
          <section className={css.summaryBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.summary.tools')}</h3>
            <ul className={css.summaryList}>
              {childTools.map(tool => (
                <li key={tool.id} data-deny={denied.has(tool.toolName ?? '') || undefined}>{tool.label}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {node.kind === 'prompt' && childSections.length > 0 ? (
          <section className={css.summaryBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.summary.sections')}</h3>
            <ul className={css.summaryList}>
              {childSections.map(section => (
                <li key={section.id}>{section.label}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {node.kind === 'ambient' && childPlugins.length > 0 ? (
          <section className={css.summaryBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.summary.plugins')}</h3>
            <ul className={css.summaryList}>
              {childPlugins.map(plugin => (
                <li key={plugin.id}>{plugin.label}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {node.adjustKind === 'model' && !locked ? (
          <section className={css.knobBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.knob.model')}</h3>
            <p className={css.knobHint}>{t('controlPlane.knob.modelHint')}</p>
            <select
              className={css.select}
              disabled={busy || snapshot.modelOptions.length === 0}
              value={knobs.modelOverride
                ? `${knobs.modelOverride.provider}::${knobs.modelOverride.model}`
                : ''}
              onChange={(event) => {
                const value = event.target.value
                if (value === '') {
                  apply({ modelOverride: null })
                  return
                }
                const [provider, model] = value.split('::')
                if (!provider || !model) return
                apply({ modelOverride: { provider, model } })
              }}
            >
              <option value="">{t('controlPlane.knob.modelDefault')}</option>
              {snapshot.modelOptions.map(opt => (
                <option key={`${opt.provider}::${opt.model}`} value={`${opt.provider}::${opt.model}`}>
                  {opt.label}
                </option>
              ))}
            </select>
          </section>
        ) : null}

        {node.adjustKind === 'tools' && !locked ? (
          <section className={css.knobBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.knob.tools')}</h3>
            <p className={css.knobHint}>{t('controlPlane.knob.toolsHint')}</p>
            <ul className={css.toolList}>
              {(node.kind === 'tool' && node.toolName
                ? [node]
                : childTools
              ).map(tool => (
                <li key={tool.id}>
                  <label className={css.checkRow}>
                    <input
                      type="checkbox"
                      checked={!denied.has(tool.toolName ?? '')}
                      disabled={busy || !tool.toolName}
                      onChange={(event) => {
                        const name = tool.toolName!
                        const next = event.target.checked
                          ? knobs.toolDeny.filter(item => item !== name)
                          : [...knobs.toolDeny, name]
                        apply({ toolDeny: next })
                      }}
                    />
                    <span className={css.toolName}>{tool.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {node.adjustKind === 'prompt' && !locked ? (
          <section className={css.knobBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.knob.prompt')}</h3>
            <p className={css.knobHint}>{t('controlPlane.knob.promptHint')}</p>
            <textarea
              className={css.textarea}
              rows={8}
              value={promptDraft}
              disabled={busy}
              placeholder={t('controlPlane.knob.promptPlaceholder')}
              onChange={(event) => { setPromptDraft(event.target.value) }}
            />
            <div className={css.actions}>
              <button
                type="button"
                className={css.btn}
                disabled={busy || promptDraft === knobs.promptAppend}
                onClick={() => { apply({ promptAppend: promptDraft }) }}
              >
                {t('controlPlane.knob.promptApply')}
              </button>
              <button
                type="button"
                className={css.btnGhost}
                disabled={busy || (promptDraft === '' && knobs.promptAppend === '')}
                onClick={() => {
                  setPromptDraft('')
                  apply({ promptAppend: '' })
                }}
              >
                {t('controlPlane.knob.promptClear')}
              </button>
            </div>
          </section>
        ) : null}

        {node.adjustKind === 'gate' && !locked ? (
          <section className={css.knobBlock}>
            <h3 className={css.knobTitle}>{t('controlPlane.knob.gate')}</h3>
            <p className={css.knobHint}>{t('controlPlane.knob.gateHint')}</p>
            <label className={css.checkRow}>
              <input
                type="checkbox"
                role="switch"
                checked={knobs.preStepReject}
                disabled={busy}
                onChange={(event) => { apply({ preStepReject: event.target.checked }) }}
              />
              <span>{knobs.preStepReject ? t('controlPlane.knob.gateOn') : t('controlPlane.knob.gateOff')}</span>
            </label>
          </section>
        ) : null}
      </div>
    </aside>
  )
}

/** Editor-hosted Agent Control Plane. */
export function ControlPlanePanel({ client, sessionId, t }: ControlPlanePanelProps) {
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  const layout = useMemo(() => {
    if (snapshot === null) return null
    return layoutControlPlaneTopology(snapshot.nodes)
  }, [snapshot])

  const selected = useMemo(() => {
    if (snapshot === null || selectedId === null) return null
    return snapshot.nodes.find(node => node.id === selectedId) ?? null
  }, [snapshot, selectedId])

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
    const target = selected?.agentId ?? sessionId
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
  }, [client, selected?.agentId, sessionId, t])

  const selectedKnobs = selected !== null && snapshot !== null
    ? knobsFor(snapshot, selected.agentId)
    : emptyKnobs()

  const activeOverlay = selectedKnobs.modelOverride !== null
    || selectedKnobs.toolDeny.length > 0
    || selectedKnobs.promptAppend.trim() !== ''
    || selectedKnobs.preStepReject

  useEffect(() => {
    if (selectedId === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [selectedId])

  return (
    <div className={css.root} data-git-ide-panel="control-plane" data-drawer={selected !== null || undefined}>
      <header className={css.head}>
        <div className={css.headText}>
          <h1 className={css.title}>{t('controlPlane.title')}</h1>
          <p className={css.subtitle}>{t('controlPlane.topoHint')}</p>
        </div>
        <div className={css.headActions}>
          {activeOverlay ? (
            <button type="button" className={css.btnGhost} disabled={busy} onClick={() => { void resetAll() }}>
              {t('controlPlane.reset')}
            </button>
          ) : null}
          <button type="button" className={css.btn} disabled={busy} onClick={() => { void reload() }}>
            {t('controlPlane.refresh')}
          </button>
        </div>
      </header>

      {snapshot?.noticeZh ? <p className={css.notice}>{snapshot.noticeZh}</p> : null}
      {loadError ? <p className={css.error} role="alert">{loadError}</p> : null}

      <div className={css.stage}>
        <div className={css.canvasWrap} onClick={() => { setSelectedId(null) }}>
          {layout === null || layout.nodes.length === 0 ? (
            <p className={css.detailEmpty}>{t('controlPlane.empty')}</p>
          ) : (
            <div
              className={css.canvas}
              style={{ width: layout.width, height: layout.height }}
              role="img"
              aria-label={t('controlPlane.graphLabel')}
            >
              <svg className={css.edges} width={layout.width} height={layout.height} aria-hidden>
                {layout.edges.map(edge => (
                  <path
                    key={edge.id}
                    className={css.edge}
                    d={edge.d}
                    fill="none"
                    stroke={edgeColor(edge.colorIndex)}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {layout.junctions.map(j => (
                  <circle
                    key={j.id}
                    className={css.junction}
                    cx={j.x}
                    cy={j.y}
                    r={JUNCTION_R}
                    fill="var(--dsw-alias-bg-base)"
                    stroke={edgeColor(j.colorIndex)}
                    strokeWidth="2"
                  />
                ))}
              </svg>
              {layout.nodes.map(box => {
                const active = selectedId === box.id
                return (
                  <button
                    key={box.id}
                    type="button"
                    className={css.node}
                    data-kind={box.node.kind}
                    data-active={active || undefined}
                    data-current={box.node.current || undefined}
                    data-adjustable={box.node.adjustable || undefined}
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.w,
                      height: box.h,
                    }}
                    title={box.node.detail ?? box.node.label}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedId(box.id)
                      setError(null)
                    }}
                  >
                    <span className={css.nodeLabel}>{shortTitle(box.node, t)}</span>
                    {box.node.status !== undefined ? (
                      <span className={css.statusDot} data-status={box.node.status} title={box.node.status} />
                    ) : null}
                    {box.node.adjustable ? <span className={css.adjMark} title={t('controlPlane.adjustable')} /> : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selected !== null && snapshot !== null ? (
          <>
            <button
              type="button"
              className={css.drawerBackdrop}
              aria-label={t('controlPlane.drawerClose')}
              onClick={() => { setSelectedId(null) }}
            />
            <Drawer
              node={selected}
              knobs={selectedKnobs}
              snapshot={snapshot}
              busy={busy}
              error={error}
              onClose={() => { setSelectedId(null) }}
              onPatch={(agentId, patch) => { void onPatch(agentId, patch) }}
              t={t}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
