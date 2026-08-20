import type { Context } from '@deepseek-ai/cordis'
import { registerControlPlane } from './host/control-plane/http.ts'
import { GitService } from './host/git-service.ts'
import { registerGitHttp } from './host/http.ts'
import { registerGitTools } from './host/tools.ts'
import { applyUltraSlash } from './host/ultra-slash/apply.ts'
import { registerSoundsHttp } from './host/workbench-sounds/http.ts'
import { WorkspaceFs } from './host/workspace-fs.ts'

export const name = 'dsh-workbench-plugin'
/** agents / systemPrompt：控制面观测与旋钮；未声明 inject 时访问 ctx.agents 会直接让 profile 启动失败。 */
export const inject = [
  'tools',
  'webServer',
  'llm',
  'agentDefaultModel',
  'commands',
  'agents',
  'systemPrompt',
]

/** Host half: Git service, workspace files, JSON API, model-facing tools, Ultra Slash, and sounds. */
export function apply(ctx: Context): void {
  const git = new GitService()
  const fs = new WorkspaceFs()
  ctx.effect(() => registerGitHttp(ctx, git, fs), 'workbench: http')
  ctx.effect(() => registerControlPlane(ctx), 'workbench: control-plane')
  ctx.effect(() => registerGitTools(ctx, git), 'workbench: tools')
  applyUltraSlash(ctx)
  ctx.effect(() => {
    const server = ctx.webServer
    if (server === undefined || typeof server.register !== 'function') return () => {}
    return registerSoundsHttp(server)
  }, 'workbench: sounds http')
}
