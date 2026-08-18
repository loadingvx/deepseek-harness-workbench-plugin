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

/** Compact GRAPH (message-only rows) is the factory default. */
export const DEFAULT_GRAPH_COMPACT = true
export const DEFAULT_GRAPH_OPEN = true
export const DEFAULT_CHANGES_OPEN = true
export const DEFAULT_GIT_SETTINGS_OPEN = false
export const DEFAULT_TERM_AI_OPEN = false
export const DEFAULT_TERM_AI_SETTINGS_OPEN = false
