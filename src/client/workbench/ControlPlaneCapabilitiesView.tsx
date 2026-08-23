/**
 * 能力配置 — 轨迹式纵向列表，只展示当前会话 Agent 及其子能力。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  emptyKnobs,
  type ControlPlaneKnobs,
  type ControlPlaneNode,
  type ControlPlaneSnapshot,
} from '../../shared/control-plane.ts'
import {
  buildCapabilitiesViewModel,
  capabilityAvatar,
  childSectionsFor,
  childToolsFor,
  type CapabilityGroup,
} from './control-plane-capabilities.ts'
import type { Translate } from './types.ts'
import css from './ControlPlaneCapabilitiesView.module.css'

export interface ControlPlaneCapabilitiesViewProps {
  snapshot: ControlPlaneSnapshot
  busy: boolean
  error: string | null
  loadError: string | null
  onPatch: (agentId: string, patch: Record<string, unknown>) => void
  t: Translate
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

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
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

function PromptTextBlock({ text, t }: { text: string; t: Translate }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const short = text.length <= 220
  const copy = async (): Promise<void> => {
    const ok = await writeClipboard(text)
    setCopied(ok)
    window.setTimeout(() => { setCopied(false) }, 1400)
  }
  return (
    <div className={css.promptBlock}>
      <pre className={css.promptText} data-clamped={!open && !short || undefined}>
        {text === '' ? t('controlPlane.prompt.empty') : text}
      </pre>
      <div className={css.promptActions}>
        {!short ? (
          <button type="button" className={css.btnGhost} onClick={() => { setOpen(o => !o) }}>
            {open ? t('controlPlane.prompt.collapse') : t('controlPlane.prompt.expand')}
          </button>
        ) : null}
        <button type="button" className={css.btnGhost} onClick={() => { void copy() }}>
          {copied ? t('controlPlane.prompt.copied') : t('controlPlane.prompt.copy')}
        </button>
      </div>
    </div>
  )
}

function AgentHeader({
  group,
  isRoot,
  t,
}: {
  group: CapabilityGroup
  isRoot: boolean
  t: Translate
}) {
  const { agent } = group
  return (
    <div className={css.agentCard}>
      <div className={css.agentHead}>
        <span className={css.avatar} aria-hidden>
          {isRoot ? 'A' : 'S'}
        </span>
        <div className={css.agentHeadText}>
          <h2 className={css.agentTitle}>
            {isRoot ? t('controlPlane.cap.agentTitle') : t('controlPlane.cap.subagentTitle')}
          </h2>
          <p className={css.agentMeta}>
            {isRoot
              ? t('controlPlane.cap.agentDesc', { id: agent.agentId?.slice(0, 12) ?? '—' })
              : t('controlPlane.cap.subagentDesc', { id: agent.agentId?.slice(0, 12) ?? '—' })}
          </p>
          <div className={css.agentFlags}>
            {agent.status ? (
              <span className={css.pill} data-tone={agent.status === 'absent' ? 'warn' : 'mute'}>
                {t('controlPlane.status.' + agent.status)}
              </span>
            ) : null}
            <span className={css.pill} data-tone="mute">{t('controlPlane.readonly')}</span>
          </div>
        </div>
        {agent.status !== undefined ? (
          <span className={css.statusDot} data-status={agent.status} title={agent.status} />
        ) : null}
      </div>
      {agent.stats && agent.stats.length > 0 ? (
        <dl className={css.statGrid}>
          {agent.stats.map(stat => (
            <div className={css.statRow} key={stat.label}>
              <dt>{stat.label}</dt>
              <dd title={stat.value}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {agent.lockReasonZh ? <p className={css.lockReason}>{agent.lockReasonZh}</p> : null}
    </div>
  )
}

function CapabilityKnobs({
  node,
  knobs,
  snapshot,
  nodes,
  busy,
  onPatch,
  t,
}: {
  node: ControlPlaneNode
  knobs: ControlPlaneKnobs
  snapshot: ControlPlaneSnapshot
  nodes: readonly ControlPlaneNode[]
  busy: boolean
  onPatch: (agentId: string, patch: Record<string, unknown>) => void
  t: Translate
}) {
  const [promptDraft, setPromptDraft] = useState(knobs.promptAppend)
  useEffect(() => {
    setPromptDraft(knobs.promptAppend)
  }, [knobs.promptAppend, snapshot.generatedAt, node.id])

  const agentId = node.agentId
  const canPatch = typeof agentId === 'string' && agentId !== ''
  const locked = !node.adjustable || !canPatch
  const denied = new Set(knobs.toolDeny)
  const tools = node.kind === 'tools' ? childToolsFor(nodes, node) : []
  const sections = node.kind === 'prompt' ? childSectionsFor(nodes, node) : []

  const apply = (patch: Record<string, unknown>): void => {
    if (!canPatch) return
    onPatch(agentId, patch)
  }

  if (node.lockReasonZh && !node.adjustable) {
    return <p className={css.lockReason}>{node.lockReasonZh}</p>
  }

  if (!canPatch && node.adjustable) {
    return <p className={css.lockReason}>{t('controlPlane.needSession')}</p>
  }

  return (
    <>
      {node.adjustKind === 'model' && !locked ? (
        <section className={css.knobBlock}>
          <h4 className={css.knobTitle}>{t('controlPlane.knob.model')}</h4>
          <p className={css.knobHint}>{t('controlPlane.knob.modelHint')}</p>
          <select
            className={css.select}
            disabled={busy || snapshot.modelOptions.length === 0}
            value={knobs.modelOverride
              ? knobs.modelOverride.provider + '::' + knobs.modelOverride.model
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
              <option key={opt.provider + '::' + opt.model} value={opt.provider + '::' + opt.model}>
                {opt.label}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {node.kind === 'tools' && tools.length > 0 ? (
        <section className={css.knobBlock}>
          <h4 className={css.knobTitle}>{t('controlPlane.summary.tools')}</h4>
          {!locked ? <p className={css.knobHint}>{t('controlPlane.knob.toolsHint')}</p> : null}
          <ul className={css.toolList}>
            {tools.map(tool => (
              <li key={tool.id}>
                {locked ? (
                  <div className={css.checkRow}>
                    <span className={css.toolInfo}>
                      <span className={css.toolName}>{tool.label}</span>
                      {tool.description ? <span className={css.toolDesc}>{tool.description}</span> : null}
                    </span>
                  </div>
                ) : (
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
                    <span className={css.toolInfo}>
                      <span className={css.toolName}>{tool.label}</span>
                      {tool.description ? <span className={css.toolDesc}>{tool.description}</span> : null}
                    </span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {node.kind === 'prompt' && sections.length > 0 ? (
        <section className={css.knobBlock}>
          <h4 className={css.knobTitle}>{t('controlPlane.summary.sections')}</h4>
          <div className={css.sectionList}>
            {sections.map(section => (
              <div className={css.sectionItem} key={section.id}>
                <div className={css.sectionHead}>
                  <span className={css.sectionName}>{section.label}</span>
                  <span className={css.sectionMeta}>
                    {section.detail ?? ''}
                    {section.promptText !== undefined ? ' · ' + section.promptText.length + ' 字符' : ''}
                  </span>
                </div>
                {section.promptText !== undefined ? (
                  <PromptTextBlock text={section.promptText} t={t} />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {node.adjustKind === 'prompt' && !locked ? (
        <section className={css.knobBlock}>
          <h4 className={css.knobTitle}>{t('controlPlane.knob.prompt')}</h4>
          <p className={css.knobHint}>{t('controlPlane.knob.promptHint')}</p>
          <textarea
            className={css.textarea}
            rows={6}
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
          <h4 className={css.knobTitle}>{t('controlPlane.knob.gate')}</h4>
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

      {node.stats && node.stats.length > 0 && node.adjustKind === 'none' ? (
        <dl className={css.statGrid}>
          {node.stats.map(stat => (
            <div className={css.statRow} key={stat.label}>
              <dt>{stat.label}</dt>
              <dd title={stat.value}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  )
}

function CapabilityRow({
  node,
  depth,
  snapshot,
  nodes,
  busy,
  onPatch,
  t,
  defaultOpen,
}: {
  node: ControlPlaneNode
  depth: number
  snapshot: ControlPlaneSnapshot
  nodes: readonly ControlPlaneNode[]
  busy: boolean
  onPatch: (agentId: string, patch: Record<string, unknown>) => void
  t: Translate
  defaultOpen?: boolean
}) {
  const knobs = knobsFor(snapshot, node.agentId)
  const hasKnob = node.adjustable
    || node.kind === 'tools'
    || node.kind === 'prompt'
    || (node.stats !== undefined && node.stats.length > 0)

  return (
    <li className={css.capRow} data-depth={depth}>
      <details className={css.capFold} open={defaultOpen}>
        <summary className={css.capSummary}>
          <span
            className={css.capAvatar}
            data-adjustable={node.adjustable || undefined}
            aria-hidden
          >
            {capabilityAvatar(node.kind)}
          </span>
          <span className={css.capMain}>
            <span className={css.capTitle}>{kindLabel(node.kind, t)}</span>
            {node.detail ? <span className={css.capDetail}>{node.detail}</span> : null}
          </span>
          <span className={css.capAside}>
            {node.badge && !node.detail ? (
              <span className={css.capBadge}>{node.badge}</span>
            ) : null}
            {node.adjustable ? (
              <span className={css.pill} data-tone="ok">{t('controlPlane.adjustable')}</span>
            ) : null}
            <span className={css.capChevron} aria-hidden />
          </span>
        </summary>
        {hasKnob ? (
          <div className={css.capBody}>
            <CapabilityKnobs
              node={node}
              knobs={knobs}
              snapshot={snapshot}
              nodes={nodes}
              busy={busy}
              onPatch={onPatch}
              t={t}
            />
          </div>
        ) : null}
      </details>
    </li>
  )
}

function AgentGroupView({
  group,
  depth,
  isRoot,
  snapshot,
  nodes,
  busy,
  onPatch,
  t,
}: {
  group: CapabilityGroup
  depth: number
  isRoot: boolean
  snapshot: ControlPlaneSnapshot
  nodes: readonly ControlPlaneNode[]
  busy: boolean
  onPatch: (agentId: string, patch: Record<string, unknown>) => void
  t: Translate
}) {
  return (
    <div className={isRoot ? undefined : css.subagentGroup}>
      <AgentHeader group={group} isRoot={isRoot} t={t} />
      <p className={css.sectionTitle}>{t('controlPlane.cap.boundaries')}</p>
      <ul className={css.thread}>
        {group.capabilities.map(cap => (
          <CapabilityRow
            key={cap.id}
            node={cap}
            depth={depth}
            snapshot={snapshot}
            nodes={nodes}
            busy={busy}
            onPatch={onPatch}
            t={t}
            defaultOpen={cap.adjustable}
          />
        ))}
      </ul>
      {group.subagents.map(sub => (
        <AgentGroupView
          key={sub.agent.id}
          group={sub}
          depth={depth + 1}
          isRoot={false}
          snapshot={snapshot}
          nodes={nodes}
          busy={busy}
          onPatch={onPatch}
          t={t}
        />
      ))}
    </div>
  )
}

export function ControlPlaneCapabilitiesView({
  snapshot,
  busy,
  error,
  loadError,
  onPatch,
  t,
}: ControlPlaneCapabilitiesViewProps) {
  const view = useMemo(() => buildCapabilitiesViewModel(snapshot), [snapshot])

  return (
    <div className={css.root}>
      {snapshot.noticeZh ? <p className={css.notice}>{snapshot.noticeZh}</p> : null}
      {loadError ? <p className={css.error} role="alert">{loadError}</p> : null}
      {error ? <p className={css.error} role="alert">{error}</p> : null}

      <div className={css.scroll}>
        {view.focus === null ? (
          <p className={css.empty}>{t('controlPlane.empty')}</p>
        ) : (
          <AgentGroupView
            group={view.focus}
            depth={0}
            isRoot
            snapshot={snapshot}
            nodes={view.nodes}
            busy={busy}
            onPatch={onPatch}
            t={t}
          />
        )}

        {view.ambient !== null ? (
          <>
            <p className={css.sectionTitle}>{t('controlPlane.cap.ambient')}</p>
            <div className={css.agentCard}>
              <div className={css.agentHead}>
                <span className={css.avatar} aria-hidden>E</span>
                <div className={css.agentHeadText}>
                  <h2 className={css.agentTitle}>{view.ambient.label}</h2>
                  {view.ambient.detail ? (
                    <p className={css.agentMeta}>{view.ambient.detail}</p>
                  ) : null}
                </div>
                {view.ambient.badge ? (
                  <span className={css.capBadge}>{view.ambient.badge}</span>
                ) : null}
              </div>
              {view.ambient.lockReasonZh ? (
                <p className={css.lockReason}>{view.ambient.lockReasonZh}</p>
              ) : null}
            </div>
            {view.plugins.length > 0 ? (
              <>
                <p className={css.sectionTitle}>{t('controlPlane.summary.plugins')}</p>
                <ul className={css.thread}>
                  {view.plugins.map(plugin => (
                    <li key={plugin.id} className={css.capRow} data-depth={1}>
                      <div
                        className={css.pluginRow}
                        data-enabled={plugin.detail !== '已禁用' || undefined}
                        title={plugin.description ?? plugin.label}
                      >
                        <span className={css.capAvatar} aria-hidden>·</span>
                        <span className={css.capText}>
                          <span className={css.capTitle}>{plugin.label}</span>
                        </span>
                        {plugin.detail ? (
                          <span className={css.capBadge}>{plugin.detail}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
