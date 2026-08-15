import type { Context } from '@deepseek-ai/cordis'
import { GitService } from './host/git-service.ts'
import { registerGitHttp } from './host/http.ts'
import { registerGitTools } from './host/tools.ts'
import { WorkspaceFs } from './host/workspace-fs.ts'

export const name = 'dsh-git-plugin'
export const inject = ['tools', 'webServer']

/** Host half: Git service, workspace files, JSON API, and model-facing tools. */
export function apply(ctx: Context): void {
  const git = new GitService()
  const fs = new WorkspaceFs()
  ctx.effect(() => registerGitHttp(ctx, git, fs), 'git: http')
  ctx.effect(() => registerGitTools(ctx, git), 'git: tools')
}
