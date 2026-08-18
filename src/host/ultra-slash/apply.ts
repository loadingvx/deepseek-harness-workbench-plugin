/**
 * Host half of Ultra Slash: register `/steer` `/new` `/skill` `/docs`,
 * load custom aliases from `$DSH_HOME/ultra-slash/commands.json`, and
 * expose the settings JSON API.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from '../../shared/ultra-slash/ids.ts'
import { registerUltraSlashHttp } from './http.ts'
import { applyCommands, createCommandHub, loadHubFromDisk, type HubContext } from './register.ts'

export function applyUltraSlash(ctx: Context): void {
  const host = ctx as unknown as HubContext
  applyCommands(host)
  const hub = createCommandHub(host)
  void loadHubFromDisk(hub)
  ctx.effect(() => {
    const server = ctx.webServer
    if (server === undefined || typeof server.register !== 'function') return () => {}
    return registerUltraSlashHttp(server, hub)
  }, `${PLUGIN_NAME}: http`)
}
