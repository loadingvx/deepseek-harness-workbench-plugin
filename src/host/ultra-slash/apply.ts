/**
 * Host half of Ultra Slash: register /steer /new /skill /docs,
 * load custom aliases and builtin default prompts from
 * $DSH_HOME/ultra-slash/commands.json, and expose the settings JSON API.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from '../../shared/ultra-slash/ids.ts'
import { registerUltraSlashHttp } from './http.ts'
import { applyCommands, createCommandHub, loadHubFromDisk, type HubContext } from './register.ts'

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
    return registerUltraSlashHttp(server, hub)
  }, PLUGIN_NAME + ': http')
}
