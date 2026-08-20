/**
 * Host half of Ultra Slash: register /steer /new /skill /docs,
 * load custom aliases and builtin default prompts from
 * $DSH_HOME/ultra-slash/commands.json, and expose the settings JSON API.
 *
 * Conflicts with a leftover standalone ultra-slash install are handled by
 * yielding (never throwing): skip the contested registration so the harness
 * and the rest of the workbench keep booting. The shared store is never
 * touched on a yield.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from '../../shared/ultra-slash/ids.ts'
import { HTTP_PREFIX, registerUltraSlashHttp } from './http.ts'
import {
  applyCommands,
  createCommandHub,
  loadHubFromDisk,
  yieldHttpPrefixConflict,
  type CommandHub,
  type HubContext,
} from './register.ts'

/** The webServer route error when the same prefix is registered twice. */
function isDuplicateRoute(error: unknown): boolean {
  return error instanceof Error && /duplicate (exact|prefix|upgrade) route/.test(error.message)
}

type WebServerFace = {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Register the settings JSON API, standing down when the prefix is already
 * owned by a standalone ultra-slash install. The owner's handler serves the
 * same shared store, so the settings UI keeps working.
 */
function registerHttpTolerant(server: WebServerFace, hub: CommandHub): () => void {
  try {
    return registerUltraSlashHttp(server, hub)
  } catch (error: unknown) {
    if (isDuplicateRoute(error)) {
      yieldHttpPrefixConflict(HTTP_PREFIX)
      return () => {}
    }
    throw error
  }
}

export function applyUltraSlash(ctx: Context): void {
  const host = ctx as unknown as HubContext
  const hub = createCommandHub(host)
  // Register builtins AFTER the hub exists so /skill and /docs read the
  // persisted per-command default prompts at invocation time.
  applyCommands(host, () => hub.defaults())
  void loadHubFromDisk(hub)
  ctx.effect(() => {
    const server = ctx.webServer
    if (server === undefined || typeof server.register !== 'function') return () => {}
    return registerHttpTolerant(server, hub)
  }, PLUGIN_NAME + ': http')
}
