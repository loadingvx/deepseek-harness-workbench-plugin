export const PLUGIN_NAME = 'dsh-workbench-plugin'
export const PLUGIN_PAGE_URL = `https://www.npmjs.com/package/${PLUGIN_NAME}`
export const PLUGIN_REPO_URL = 'https://github.com/loadingvx/deepseek-harness-workbench-plugin'

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

export function upgradeCommand(latest: string): string {
  return `dsh plugin --profile web add ${PLUGIN_NAME}@${latest}`
}

/** Comment lines to type into the workspace terminal. Last line stays on the prompt. */
export function updateTermSeed(command: string, hint: string): string {
  const cleanHint = hint.replace(/^\s*#\s?/, '').trim()
  const cleanCommand = command.replace(/^\s*#\s?/, '').trim()
  return `# ${cleanHint}\n# ${cleanCommand}`
}
