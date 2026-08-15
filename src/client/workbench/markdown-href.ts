import { joinWorkspaceFile, suggestNewFileDir } from '../../shared/new-file-path.ts'
import { redactSecrets } from '../../shared/redact.ts'

export type MarkdownHref =
  | { kind: 'hash'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'file'; value: string }

/** Allow in-page hashes, http(s)/mailto, and workspace-relative files. Block javascript/data/file. */
export function classifyMarkdownHref(fromFile: string, href: string | undefined): MarkdownHref | null {
  if (href === undefined) return null
  const trimmed = href.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('#')) return { kind: 'hash', value: trimmed.slice(0, 200) }
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:')
    || lower.startsWith('data:')
    || lower.startsWith('vbscript:')
    || lower.startsWith('file:')
  ) return null
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return { kind: 'url', value: redactSecrets(trimmed) }
  }
  const pathOnly = trimmed.replace(/[?#].*$/, '')
  if (pathOnly.startsWith('/')) {
    const joined = joinWorkspaceFile('', pathOnly.replace(/^\/+/u, ''))
    return joined === null ? null : { kind: 'file', value: joined }
  }
  const dir = suggestNewFileDir(fromFile, 'file')
  const joined = joinWorkspaceFile(dir, pathOnly)
  return joined === null ? null : { kind: 'file', value: joined }
}

export function isSafeMarkdownImageSrc(src: string | undefined): src is string {
  if (src === undefined) return false
  const trimmed = src.trim()
  if (trimmed === '') return false
  return /^https?:\/\//i.test(trimmed)
}
