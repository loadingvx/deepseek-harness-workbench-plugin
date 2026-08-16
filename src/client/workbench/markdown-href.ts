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

export type MarkdownImageSrc =
  | { kind: 'url'; value: string }
  | { kind: 'file'; value: string }

/**
 * Resolve a workspace-relative path against the current file's directory,
 * allowing \`..\` up to the workspace root (unlike links, which stay in the
 * current directory). Anything escaping the root returns null.
 */
function normalizeWorkspaceRel(dir: string, raw: string): string | null {
  const folder = dir.trim().replace(/\\/g, '/')
  const file = raw.trim().replace(/\\/g, '/')
  if (file === '') return null
  const stack: string[] = []
  for (const part of [...folder.split('/'), ...file.split('/')]) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (part.includes('\0') || /[<>:"|?*]/.test(part)) return null
    stack.push(part)
  }
  if (stack.length === 0) return null
  return stack.join('/')
}

/**
 * Classify a markdown image source: http(s) URLs render directly; relative
 * paths are resolved against the current file's directory into workspace
 * files served through /git/fs/img. javascript/data/file and paths escaping
 * the workspace root are blocked.
 */
export function classifyMarkdownImageSrc(fromFile: string, src: string | undefined): MarkdownImageSrc | null {
  if (src === undefined) return null
  const trimmed = src.trim()
  if (trimmed === '') return null
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:')
    || lower.startsWith('data:')
    || lower.startsWith('vbscript:')
    || lower.startsWith('file:')
  ) return null
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', value: redactSecrets(trimmed) }
  }
  const pathOnly = trimmed.replace(/[?#].*$/, '')
  if (pathOnly.startsWith('/')) {
    const joined = normalizeWorkspaceRel('', pathOnly.replace(/^\/+/u, ''))
    return joined === null ? null : { kind: 'file', value: joined }
  }
  const dir = suggestNewFileDir(fromFile, 'file')
  const joined = normalizeWorkspaceRel(dir, pathOnly)
  return joined === null ? null : { kind: 'file', value: joined }
}
