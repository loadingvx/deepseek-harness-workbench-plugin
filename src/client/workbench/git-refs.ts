import type { GitRefKind, GitRefMark } from '../../shared/types.ts'

/** Host 新版本给 { name, kind }；旧进程可能仍给字符串。两种都要能画出文字。 */
export function toRefMark(ref: GitRefMark | string): GitRefMark | null {
  if (typeof ref === 'string') {
    const name = ref.trim()
    if (name === '') return null
    if (name.startsWith('tag: ')) return { name: name.slice(5), kind: 'tag' }
    if (name.includes('/') && name.endsWith('/HEAD')) return null
    if (name.includes('/')) return { name, kind: 'remote' }
    return { name, kind: 'branch' }
  }
  if (ref === null || typeof ref !== 'object' || typeof ref.name !== 'string') return null
  const name = ref.name.trim()
  if (name === '') return null
  if (name.includes('/') && name.endsWith('/HEAD')) return null
  const kind: GitRefKind = ref.kind === 'tag' || ref.kind === 'remote' ? ref.kind : 'branch'
  return { name, kind }
}
