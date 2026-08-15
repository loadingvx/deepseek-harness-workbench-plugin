import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginUpdateSnapshot } from '../shared/types.ts'
import { isNewer, PLUGIN_NAME, upgradeCommand } from '../shared/version.ts'

const REGISTRY_LATEST = `https://registry.npmjs.org/${PLUGIN_NAME}/latest`
const CACHE_MS = 6 * 60 * 60 * 1000
const FETCH_MS = 4_000

export interface UpdateCheckDeps {
  fetchLatest?: (signal: AbortSignal) => Promise<string | null>
  now?: () => number
}

let cached: { at: number; value: PluginUpdateSnapshot } | null = null

export function readInstalledVersion(from = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from)
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown }
      if (pkg.name === PLUGIN_NAME && typeof pkg.version === 'string' && pkg.version !== '') {
        return pkg.version
      }
    } catch { /* keep walking */ }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}

async function defaultFetchLatest(signal: AbortSignal): Promise<string | null> {
  const response = await fetch(REGISTRY_LATEST, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return null
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('version' in body)) return null
  const version = (body as { version?: unknown }).version
  return typeof version === 'string' && version !== '' ? version : null
}

function snapshot(current: string, latest: string | null): PluginUpdateSnapshot {
  const outdated = latest !== null && isNewer(latest, current)
  return {
    name: PLUGIN_NAME,
    current,
    latest,
    outdated,
    command: latest === null ? `dsh plugin --profile web add ${PLUGIN_NAME}` : upgradeCommand(latest),
  }
}

/** Compare the installed plugin with npm latest. Network/registry failures stay quiet. */
export async function checkPluginUpdate(deps: UpdateCheckDeps = {}): Promise<PluginUpdateSnapshot> {
  const installed = readInstalledVersion()
  const now = deps.now ?? Date.now
  if (cached !== null && now() - cached.at < CACHE_MS && cached.value.current === installed) {
    return cached.value
  }
  const fetchLatest = deps.fetchLatest ?? defaultFetchLatest
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, FETCH_MS)
  let latest: string | null = null
  try {
    latest = await fetchLatest(controller.signal)
  } catch {
    latest = null
  } finally {
    clearTimeout(timer)
  }
  const value = snapshot(installed, latest)
  if (latest !== null) cached = { at: now(), value }
  return value
}

export function resetUpdateCache(): void {
  cached = null
}
