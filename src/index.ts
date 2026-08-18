import type { Context } from '@deepseek-ai/cordis'
import { GitService } from './host/git-service.ts'
import { registerGitHttp } from './host/http.ts'
import { registerGitTools } from './host/tools.ts'
import { applyUltraSlash } from './host/ultra-slash/apply.ts'
import { WorkspaceFs } from './host/workspace-fs.ts'

export const name = 'dsh-workbench-plugin'
export const inject = ['tools', 'webServer', 'llm', 'agentDefaultModel', 'commands']

/** Host half: Git service, workspace files, JSON API, model-facing tools, and Ultra Slash. */
export function apply(ctx: Context): void {
  const git = new GitService()
  const fs = new WorkspaceFs()
  ctx.effect(() => registerGitHttp(ctx, git, fs), 'workbench: http')
  ctx.effect(() => registerGitTools(ctx, git), 'workbench: tools')
  applyUltraSlash(ctx)
}
