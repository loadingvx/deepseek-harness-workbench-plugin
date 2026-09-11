/**
 * Handlers the IDE host registers so official-sidebar panes can open diffs
 * (and later files) in the center editor without holding a React tree link.
 */
export type WorkbenchDiffHandler = (path: string, staged: boolean, repo?: string) => void
export type WorkbenchCommitDiffHandler = (hash: string, path: string, repo?: string) => void

type WorkbenchActions = {
  openDiff: WorkbenchDiffHandler
  openCommitDiff: WorkbenchCommitDiffHandler
}

let actions: WorkbenchActions | undefined

export function registerWorkbenchActions(next: WorkbenchActions): () => void {
  actions = next
  return () => {
    if (actions === next) actions = undefined
  }
}

export function openWorkbenchDiff(path: string, staged: boolean, repo?: string): void {
  actions?.openDiff(path, staged, repo)
}

export function openWorkbenchCommitDiff(hash: string, path: string, repo?: string): void {
  actions?.openCommitDiff(hash, path, repo)
}
