import {
  emptyKnobs,
  type ControlPlaneKnobPatch,
  type ControlPlaneKnobs,
} from '../../shared/control-plane.ts'

function normalizeDeny(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function normalizeModel(
  value: unknown,
): { provider: string; model: string } | null {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) return null
  const row = value as { provider?: unknown; model?: unknown }
  if (typeof row.provider !== 'string' || row.provider.trim() === '') return null
  if (typeof row.model !== 'string' || row.model.trim() === '') return null
  return { provider: row.provider.trim(), model: row.model.trim() }
}

/** In-memory per-session knob store. Survives agent dispose/recreate within the process. */
export class ControlPlaneKnobStore {
  private readonly bySession = new Map<string, ControlPlaneKnobs>()

  get(sessionId: string): ControlPlaneKnobs {
    return this.bySession.get(sessionId) ?? emptyKnobs()
  }

  /** True when any non-default overlay is active. */
  isActive(sessionId: string): boolean {
    const knobs = this.get(sessionId)
    return knobs.modelOverride !== null
      || knobs.toolDeny.length > 0
      || knobs.promptAppend.trim() !== ''
      || knobs.preStepReject
  }

  patch(sessionId: string, patch: ControlPlaneKnobPatch): ControlPlaneKnobs {
    if (patch.reset === true) {
      this.bySession.delete(sessionId)
      return emptyKnobs()
    }
    const current = { ...this.get(sessionId), toolDeny: [...this.get(sessionId).toolDeny] }
    if (Object.prototype.hasOwnProperty.call(patch, 'modelOverride')) {
      current.modelOverride = normalizeModel(patch.modelOverride)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'toolDeny')) {
      current.toolDeny = normalizeDeny(patch.toolDeny)
    }
    if (typeof patch.promptAppend === 'string') {
      current.promptAppend = patch.promptAppend.slice(0, 8_000)
    }
    if (typeof patch.preStepReject === 'boolean') {
      current.preStepReject = patch.preStepReject
    }
    const empty = emptyKnobs()
    const idle = current.modelOverride === null
      && current.toolDeny.length === 0
      && current.promptAppend.trim() === ''
      && !current.preStepReject
    if (idle) {
      this.bySession.delete(sessionId)
      return empty
    }
    this.bySession.set(sessionId, current)
    return current
  }
}
