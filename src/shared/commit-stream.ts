import type { GitFail } from './types.ts'

export type CommitStreamDelta = { type: 'delta'; text: string }
export type CommitStreamDone = { type: 'done'; message: string }
export type CommitStreamLine = CommitStreamDelta | CommitStreamDone | GitFail

/** One NDJSON line from `/git/commit-message/stream`. Blank / junk lines are ignored. */
export function parseCommitStreamLine(line: string): CommitStreamLine | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const row = parsed as Record<string, unknown>
  if (
    row.ok === false
    && typeof row.code === 'string'
    && typeof row.messageZh === 'string'
    && typeof row.hintZh === 'string'
  ) {
    return {
      ok: false,
      code: row.code as GitFail['code'],
      messageZh: row.messageZh,
      hintZh: row.hintZh,
    }
  }
  if (row.type === 'delta' && typeof row.text === 'string') return { type: 'delta', text: row.text }
  if (row.type === 'done' && typeof row.message === 'string') return { type: 'done', message: row.message }
  return null
}
