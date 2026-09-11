/**
 * Resolve insert spans for the Lexical composer (dsh ≥ 0.1.5).
 * Detect-coordinate caret comes from SessionInputShell.caretSpan(); the
 * published useInput draft is clipboard projection and must not drive spans.
 */

type ScopedCtx = {
  bail: (thisArg: unknown, name: string, payload: unknown) => unknown
  get: (name: string) => unknown
}

export type InsertSpan = { start: number; end: number; draftRev: number }

type ComposerInput = {
  notify?: (level: string, message: string) => void
  snapshot?: {
    draftRev?: number
    occurrences?: ReadonlyArray<{ source?: string; ref?: string; label?: string }>
  }
  caretSpan?: () => { start: number; end: number }
}

export function conversationComposerInput(actx: ScopedCtx): ComposerInput | undefined {
  const conversation = actx.get('conversation') as {
    input?: { for?: (ctx: unknown) => unknown }
  } | undefined
  try {
    const input = conversation?.input?.for?.(actx)
    if (input === null || typeof input !== 'object') return undefined
    return input as ComposerInput
  } catch {
    return undefined
  }
}

/**
 * Prefer the shell's live detect-coordinate caret + draftRev.
 * Falls back to the caller's span when the shell face is unavailable (tests / older harness).
 */
export function resolveInsertSpan(actx: ScopedCtx, fallback: InsertSpan): InsertSpan {
  const input = conversationComposerInput(actx)
  const caret = input?.caretSpan?.()
  const draftRev = input?.snapshot?.draftRev
  if (caret === undefined || typeof draftRev !== 'number') return fallback
  return { start: caret.start, end: caret.end, draftRev }
}
