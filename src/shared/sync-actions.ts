/** Which of the three sync buttons should appear. At most commit / push / pull. */
export function visibleSyncActions(input: {
  dirtyCount: number
  detached: boolean
  ahead: number
  behind: number
  hasRemote: boolean
  hasUpstream: boolean
  hasHead: boolean
}): { commit: boolean; push: boolean; pull: boolean } {
  const commit = input.dirtyCount > 0
  const pull = !input.detached && input.hasRemote && input.behind > 0
  const unpublished = !input.hasUpstream && input.hasHead && input.dirtyCount === 0
  const push = !input.detached && input.hasRemote && (input.ahead > 0 || unpublished)
  return { commit, push, pull }
}
