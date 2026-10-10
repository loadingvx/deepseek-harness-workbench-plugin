import type { Translate } from './types.ts'

/** Uploads stream straight to disk on the host; this is the same cap the host enforces. */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024

export type TransferAction = 'upload' | 'download' | 'download-dir' | 'sizes'
export type EntryKind = 'file' | 'directory' | 'other'

export interface SelectedEntry {
  path: string
  kind: EntryKind
}

/** Absolute path inside the Files tab root → workspace-relative path the transfer routes expect. */
export function transferRelativePath(root: string, absolute: string): string {
  const base = root.replace(/\/+$/, '')
  if (absolute === base) return ''
  if (!absolute.startsWith(`${base}/`)) throw new Error('outside')
  const rel = absolute.slice(base.length + 1)
  if (rel.split('/').some((part) => part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    throw new Error('invalid')
  }
  return rel
}

/** Upload target folder: the selected folder, the selected file's folder, or the root. */
export function transferTargetDir(root: string, selected: SelectedEntry | null): string {
  if (selected === null) return ''
  const rel = transferRelativePath(root, selected.path)
  if (selected.kind === 'directory') return rel
  const slash = rel.lastIndexOf('/')
  return slash === -1 ? '' : rel.slice(0, slash)
}

export function transferActionFor(kind: EntryKind): TransferAction {
  return kind === 'directory' ? 'download-dir' : 'download'
}

export function transferUrl(action: TransferAction, sessionId: string, path: string): string {
  return `/git/fs/${action}?${new URLSearchParams({ sessionId, path }).toString()}`
}

/** Prefer the host's own Chinese copy; fall back to a status-shaped message. */
export function transferErrorMessage(status: number, body: unknown, t: Translate): string {
  if (typeof body === 'object' && body !== null && typeof (body as { messageZh?: unknown }).messageZh === 'string') {
    const message = (body as { messageZh: string }).messageZh
    if (message !== '') return message
  }
  if (status === 409) return t('transfer.exists')
  return `${t('transfer.failed')} (HTTP ${status})`
}

/** Row-friendly size: `512 B`, `12.4 KB`, `3.4 MB`. Binary units, since these are disk files. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const text = value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
  return `${trimmed} ${units[index]}`
}

export interface TransferResult {
  name: string
  state: 'queued' | 'uploading' | 'done' | 'error'
  percent: number
  message?: string
}
