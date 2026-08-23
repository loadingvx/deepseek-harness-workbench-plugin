/**
 * Pure hunk math for Agent review Keep/Undo.
 * One baseline per file; hunks are recomputed as structuredPatch(baseline, current).
 * @module
 */
import { createHash } from 'node:crypto'
import { structuredPatch } from 'diff'
import type { ReviewHunk } from './types.ts'

/** Context lines around each applied hunk (matches dsh-tool-fs). */
export const REVIEW_DIFF_CONTEXT = 3

/** Content fingerprint for stale checks. */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function countLines(text: string): number {
  if (text === '') return 0
  // Trailing newline terminates the last line; does not add a phantom empty one.
  return text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length
}

/**
 * Compute review hunks between baseline and current disk content.
 * `baseline === null` means the file did not exist (treat as empty string).
 */
export function computeReviewHunks(path: string, baseline: string | null, current: string): ReviewHunk[] {
  const before = baseline ?? ''
  if (before === current) return []
  const patch = structuredPatch('', '', before, current, undefined, undefined, { context: REVIEW_DIFF_CONTEXT })
  const out: ReviewHunk[] = []
  let index = 0
  for (const hunk of patch.hunks) {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      const text = line.slice(1)
      if (line.startsWith('-')) oldLines.push(text)
      else if (line.startsWith('+')) newLines.push(text)
      else {
        oldLines.push(text)
        newLines.push(text)
      }
    }
    const oldText = oldLines.length > 0 ? oldLines.join('\n') : null
    const newText = newLines.join('\n')
    const id = createHash('sha1')
      .update(`${path}\0${index}\0${oldText ?? ''}\0${newText}`)
      .digest('hex')
      .slice(0, 12)
    out.push({ id, oldText, newText })
    index += 1
  }
  return out
}

export function tallyHunkLines(hunks: readonly ReviewHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    added += countLines(hunk.newText)
    removed += hunk.oldText === null ? 0 : countLines(hunk.oldText)
  }
  return { added, removed }
}

function replaceOnce(haystack: string, from: string, to: string, ambiguousCode: 'REVIEW_AMBIGUOUS'): string {
  if (from === '') {
    if (haystack === '') return to
    throw Object.assign(new Error(ambiguousCode), { code: ambiguousCode })
  }
  const first = haystack.indexOf(from)
  if (first === -1) throw Object.assign(new Error('REVIEW_STALE'), { code: 'REVIEW_STALE' })
  const second = haystack.indexOf(from, first + from.length)
  if (second !== -1) throw Object.assign(new Error(ambiguousCode), { code: ambiguousCode })
  return haystack.slice(0, first) + to + haystack.slice(first + from.length)
}

/**
 * Fold one hunk into the baseline (Keep hunk): baseline advances toward current.
 */
export function applyHunkToBaseline(baseline: string | null, hunk: ReviewHunk): string {
  const text = baseline ?? ''
  if (hunk.oldText === null) {
    if (text === '') return hunk.newText
    // Insertion hunk with context lives entirely on the new side; find unique context
    // by applying as "insert newText where oldText would have been" — without old side,
    // only empty baseline is safe.
    throw Object.assign(new Error('REVIEW_AMBIGUOUS'), { code: 'REVIEW_AMBIGUOUS' })
  }
  return replaceOnce(text, hunk.oldText, hunk.newText, 'REVIEW_AMBIGUOUS')
}

/**
 * Reverse one hunk on current disk (Undo hunk): current moves toward baseline.
 */
export function reverseHunkOnCurrent(current: string, hunk: ReviewHunk): string {
  if (hunk.oldText === null) {
    if (current === hunk.newText || current === `${hunk.newText}\n`) return ''
    if (hunk.newText !== '' && current.endsWith(`\n${hunk.newText}`)) {
      return current.slice(0, current.length - hunk.newText.length - 1)
    }
    if (hunk.newText !== '' && current.endsWith(hunk.newText)) {
      return current.slice(0, current.length - hunk.newText.length)
    }
    return replaceOnce(current, hunk.newText, '', 'REVIEW_AMBIGUOUS')
  }
  return replaceOnce(current, hunk.newText, hunk.oldText, 'REVIEW_AMBIGUOUS')
}

export function findHunk(hunks: readonly ReviewHunk[], id: string): ReviewHunk | undefined {
  return hunks.find(h => h.id === id)
}
