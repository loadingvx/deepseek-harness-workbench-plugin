import type { GitRefKind, GitRefMark } from '../../shared/types.ts'

function shortRefName(raw: string): string {
  if (raw.startsWith('refs/heads/')) return raw.slice('refs/heads/'.length)
  if (raw.startsWith('refs/remotes/')) return raw.slice('refs/remotes/'.length)
  if (raw.startsWith('refs/tags/')) return raw.slice('refs/tags/'.length)
  return raw
}

/** Host 新版本给 { name, kind }；旧进程可能仍给字符串。两种都要能画出文字。 */
export function toRefMark(ref: GitRefMark | string): GitRefMark | null {
  if (typeof ref === 'string') {
    const trimmed = ref.trim()
    if (trimmed === '') return null
    if (trimmed.startsWith('tag: ')) {
      const name = shortRefName(trimmed.slice(5))
      return name === '' ? null : { name, kind: 'tag' }
    }
    if (trimmed.startsWith('refs/heads/')) {
      const name = shortRefName(trimmed)
      return name === '' ? null : { name, kind: 'branch' }
    }
    if (trimmed.startsWith('refs/remotes/')) {
      const name = shortRefName(trimmed)
      if (name === '' || name.endsWith('/HEAD')) return null
      return { name, kind: 'remote' }
    }
    if (trimmed.startsWith('refs/tags/')) {
      const name = shortRefName(trimmed)
      return name === '' ? null : { name, kind: 'tag' }
    }
    if (trimmed.includes('/') && trimmed.endsWith('/HEAD')) return null
    if (trimmed.includes('/')) return { name: trimmed, kind: 'remote' }
    return { name: trimmed, kind: 'branch' }
  }
  if (ref === null || typeof ref !== 'object' || typeof ref.name !== 'string') return null
  const name = shortRefName(ref.name.trim())
  if (name === '') return null
  if (name.includes('/') && name.endsWith('/HEAD')) return null
  const kind: GitRefKind = ref.kind === 'tag' || ref.kind === 'remote' ? ref.kind : 'branch'
  return { name, kind }
}
