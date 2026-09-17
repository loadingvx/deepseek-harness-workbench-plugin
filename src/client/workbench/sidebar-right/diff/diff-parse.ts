export type DiffRow = { kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string }

export function parseDiff(text: string): DiffRow[] {
  if (text.trim() === '') return []
  return text.split(/\r?\n/).map((line) => {
    if (
      line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')
      || line.startsWith('index ') || line.startsWith('new file ') || line.startsWith('deleted file ')
      || line.startsWith('old mode ') || line.startsWith('new mode ')
      || line.startsWith('rename from ') || line.startsWith('rename to ')
      || line.startsWith('copy from ') || line.startsWith('copy to ')
      || line.startsWith('similarity index') || line.startsWith('Binary files ')
    ) {
      return { kind: 'meta' as const, text: line }
    }
    if (line.startsWith('@@')) return { kind: 'hunk' as const, text: line }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line }
    if (line.startsWith('-')) return { kind: 'del' as const, text: line }
    return { kind: 'ctx' as const, text: line }
  })
}

export function isBinaryDiff(text: string): boolean {
  return /^Binary files /m.test(text)
}

export function isNewEmptyDiff(text: string, rows: DiffRow[]): boolean {
  if (rows.some(row => row.kind === 'add' || row.kind === 'del')) return false
  return /^new file /m.test(text) || /^--- \/dev\/null$/m.test(text)
}
