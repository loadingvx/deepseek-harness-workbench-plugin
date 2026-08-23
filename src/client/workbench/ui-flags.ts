/** localStorage boolean flags: `'1'` / `'0'`. Missing or unreadable → fallback. */

export function readBoolFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch { /* private mode */ }
  return fallback
}

export function writeBoolFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* quota / private mode */ }
}

export const GRAPH_COMPACT_KEY = 'dsh-workbench-graph-compact'
export const GRAPH_OPEN_KEY = 'dsh-workbench-graph-open'
export const CHANGES_OPEN_KEY = 'dsh-workbench-changes-open'
export const GIT_SETTINGS_OPEN_KEY = 'dsh-workbench-git-settings-open'
export const TERM_AI_OPEN_KEY = 'dsh-workbench-term-ai-open'
export const TERM_AI_SETTINGS_OPEN_KEY = 'dsh-workbench-term-ai-settings-open'
export const SETTINGS_SOUND_OPEN_KEY = 'dsh-workbench-settings-sound-open'
export const SETTINGS_COMMANDS_OPEN_KEY = 'dsh-workbench-settings-commands-open'
export const SETTINGS_SVG_RENDER_OPEN_KEY = 'dsh-workbench-settings-svg-render-open'
export const SETTINGS_CONTROL_PLANE_OPEN_KEY = 'dsh-workbench-settings-control-plane-open'
export const CONTROL_PLANE_VISIBLE_KEY = 'dsh-workbench-control-plane-visible'
export const SETTINGS_REVIEW_OPEN_KEY = 'dsh-workbench-settings-review-open'

/** Compact GRAPH (message-only rows) is the factory default. */
export const DEFAULT_GRAPH_COMPACT = true
export const DEFAULT_GRAPH_OPEN = true
export const DEFAULT_CHANGES_OPEN = true
export const DEFAULT_GIT_SETTINGS_OPEN = false
export const DEFAULT_TERM_AI_OPEN = false
export const DEFAULT_TERM_AI_SETTINGS_OPEN = false

/** 设置面板折叠分区默认全部展开（与 git CHANGES 折叠交互一致）。 */
export const DEFAULT_SETTINGS_SOUND_OPEN = true
export const DEFAULT_SETTINGS_COMMANDS_OPEN = true
export const DEFAULT_SETTINGS_SVG_RENDER_OPEN = true
export const DEFAULT_SETTINGS_CONTROL_PLANE_OPEN = true
/** Agent Control Plane 编辑器首 Tab：默认开启。 */
export const DEFAULT_CONTROL_PLANE_VISIBLE = true
export const DEFAULT_SETTINGS_REVIEW_OPEN = true
