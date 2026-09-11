export const PLUGIN_NAME = 'dsh-workbench-plugin'
export const PLUGIN_PAGE_URL = `https://www.npmjs.com/package/${PLUGIN_NAME}`
export const PLUGIN_REPO_URL = 'https://github.com/loadingvx/deepseek-harness-workbench-plugin'
export const PLUGIN_ISSUES_URL = `${PLUGIN_REPO_URL}/issues`

/**
 * Host deepseek-harness / `@deepseek-ai/dsh` floor for the current plugin line.
 * 0.1.5 introduced official `ui-sidebar-right`; older hosts break if this plugin is installed.
 */
export const MIN_HARNESS_VERSION = '0.1.5'

export function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** True when `latest` is a higher x.y.z than `current`. Garbage versions never trigger an upgrade. */
export function isNewer(latest: string, current: string): boolean {
  const next = parseSemver(latest)
  const now = parseSemver(current)
  if (next === null || now === null) return false
  if (next[0] !== now[0]) return next[0] > now[0]
  if (next[1] !== now[1]) return next[1] > now[1]
  return next[2] > now[2]
}

/** True when `actual` is at least `min` (prerelease suffix ignored; `0.1.5-rc.2` counts as 0.1.5). */
export function meetsMinVersion(actual: string, min: string): boolean {
  const a = parseSemver(actual)
  const m = parseSemver(min)
  if (a === null || m === null) return false
  if (a[0] !== m[0]) return a[0] > m[0]
  if (a[1] !== m[1]) return a[1] > m[1]
  return a[2] >= m[2]
}

export function upgradeCommand(latest: string): string {
  return `dsh plugin --profile web add ${PLUGIN_NAME}@${latest}`
}

/** Comment lines to type into the workspace terminal. Last line stays on the prompt. */
export function updateTermSeed(command: string, hint: string): string {
  const cleanHint = hint.replace(/^\s*#\s?/, '').trim()
  const cleanCommand = command.replace(/^\s*#\s?/, '').trim()
  if (cleanCommand === '') return `# ${cleanHint}`
  return `# ${cleanHint}\n# ${cleanCommand}`
}
