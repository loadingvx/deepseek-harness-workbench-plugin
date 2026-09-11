import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginUpdateSnapshot } from '../shared/types.ts'
import {
  isNewer,
  meetsMinVersion,
  MIN_HARNESS_VERSION,
  PLUGIN_NAME,
  upgradeCommand,
} from '../shared/version.ts'

const REGISTRY_LATEST = `https://registry.npmjs.org/${PLUGIN_NAME}/latest`
const CACHE_MS = 6 * 60 * 60 * 1000
const FETCH_MS = 4_000

const pluginRoot = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as { name?: unknown }
      if (pkg.name === PLUGIN_NAME) return dir
    } catch { /* keep walking */ }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirname(fileURLToPath(import.meta.url))
})()

export interface UpdateCheckDeps {
  fetchLatest?: (signal: AbortSignal) => Promise<string | null>
  /** Override host version detection (tests). */
  readHarnessVersion?: () => string | null
  /** Override sidebar-right presence (tests). */
  hasSidebarRight?: () => boolean
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

function readVersionFile(pkgJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
  } catch {
    return null
  }
}

/** Paths that represent the running host — never the plugin's own peerDependencies copy. */
function hostLookupRoots(): string[] {
  const roots: string[] = []
  const profileNm = join(homedir(), '.dsh', 'profiles', 'node_modules')
  if (existsSync(profileNm)) roots.push(join(profileNm, 'probe.js'))
  // `dsh` CLI argv when the host boots the plugin (…/@deepseek-ai/dsh/lib/bin.js).
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1 !== '') roots.push(argv1)
  return roots
}

function resolveOutsidePlugin(id: string): string | null {
  for (const root of hostLookupRoots()) {
    try {
      const resolved = createRequire(root).resolve(id)
      if (!resolved.startsWith(pluginRoot)) return resolved
    } catch { /* try next root */ }
  }
  // Nested under the CLI package (not always hoisted into profiles/node_modules).
  const dshPkg = resolveOutsidePluginNestable('@deepseek-ai/dsh/package.json')
  if (dshPkg !== null) {
    try {
      const resolved = createRequire(dshPkg).resolve(id)
      if (!resolved.startsWith(pluginRoot)) return resolved
    } catch { /* absent on old hosts */ }
  }
  return null
}

/** Like resolveOutsidePlugin but without nested fallback (avoids recursion). */
function resolveOutsidePluginNestable(id: string): string | null {
  for (const root of hostLookupRoots()) {
    try {
      const resolved = createRequire(root).resolve(id)
      if (!resolved.startsWith(pluginRoot)) return resolved
    } catch { /* try next root */ }
  }
  return null
}

function readHostPkgVersion(id: string): string | null {
  const pkgPath = resolveOutsidePlugin(`${id}/package.json`)
  return pkgPath === null ? null : readVersionFile(pkgPath)
}

/**
 * Best-effort host version from the profile / CLI install.
 * Must not read the plugin's own `node_modules` peer copy of dsh-tools.
 */
export function readHarnessVersion(): string | null {
  return readHostPkgVersion('@deepseek-ai/dsh') ?? readHostPkgVersion('@deepseek-ai/dsh-tools')
}

/** Official right Sidebar landed with harness 0.1.5; presence means the host can load this plugin. */
export function hasOfficialSidebarRight(): boolean {
  return resolveOutsidePlugin('@deepseek-ai/dsh-client-ui-sidebar-right/package.json') !== null
    || resolveOutsidePlugin('@deepseek-ai/dsh-client-ui-sidebar-right') !== null
}

/**
 * Whether installing the current plugin line is safe on this host.
 * Prefer an explicit version ≥ 0.1.5; otherwise allow only when ui-sidebar-right is already on disk.
 */
export function canInstallLatestPlugin(
  harnessVersion: string | null,
  hasSidebarRight: boolean,
  minHarness = MIN_HARNESS_VERSION,
): boolean {
  if (harnessVersion !== null && meetsMinVersion(harnessVersion, minHarness)) return true
  if (hasSidebarRight) return true
  return false
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

function snapshot(
  current: string,
  latest: string | null,
  harnessVersion: string | null,
  hasSidebarRight: boolean,
): PluginUpdateSnapshot {
  const outdated = latest !== null && isNewer(latest, current)
  const installAllowed = canInstallLatestPlugin(harnessVersion, hasSidebarRight)
  return {
    name: PLUGIN_NAME,
    current,
    latest,
    outdated,
    command: latest === null ? `dsh plugin --profile web add ${PLUGIN_NAME}` : upgradeCommand(latest),
    harnessVersion,
    minHarness: MIN_HARNESS_VERSION,
    installAllowed,
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
  const harnessVersion = (deps.readHarnessVersion ?? readHarnessVersion)()
  const hasSidebarRight = (deps.hasSidebarRight ?? hasOfficialSidebarRight)()
  const value = snapshot(installed, latest, harnessVersion, hasSidebarRight)
  if (latest !== null) cached = { at: now(), value }
  return value
}

export function resetUpdateCache(): void {
  cached = null
}
