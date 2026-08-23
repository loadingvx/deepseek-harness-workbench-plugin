import type { MermaidApi } from './mermaid-api.ts'

function pluginBuildRev(): string {
  const rev = import.meta.env?.WB_REV
  return typeof rev === 'string' && rev !== '' ? rev : 'dev'
}

/** Same-origin ESM built beside the host. DSH ModuleLoader cannot load this file. */
export function mermaidVendorUrl(): string {
  return `/git/vendor/mermaid.js?rev=${encodeURIComponent(pluginBuildRev())}`
}

function isMermaidApi(value: unknown): value is MermaidApi {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { initialize?: unknown; render?: unknown }
  return typeof candidate.initialize === 'function' && typeof candidate.render === 'function'
}

function fromModule(mod: unknown): MermaidApi {
  if (isMermaidApi(mod)) return mod
  if (mod !== null && typeof mod === 'object' && 'default' in mod && isMermaidApi(mod.default)) {
    return mod.default
  }
  throw new Error('mermaid vendor module missing initialize/render')
}

let pending: Promise<MermaidApi> | undefined

/**
 * Native `import(url)` with a runtime specifier so the bundler cannot inline mermaid
 * into `client.js` (DSH ModuleLoader has no sibling chunks).
 */
export function loadMermaid(): Promise<MermaidApi> {
  pending ??= import(mermaidVendorUrl()).then(fromModule)
  pending.catch(() => {
    pending = undefined
  })
  return pending
}
