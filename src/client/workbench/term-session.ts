/** User logout (`exit` / Ctrl+D) is exit code 0. Host kill() emits null — not a logout. */
export function isCleanTermExit(code: number | null): boolean {
  return code === 0
}

/** After a clean logout: drop this extra tab, or hide the panel and keep the pinned terminal. */
export type TermCleanExitAction = 'close' | 'hide'
