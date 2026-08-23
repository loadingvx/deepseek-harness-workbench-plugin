/** Directory of the current editor tab. Terminal / empty → workspace root. */
export function suggestNewFileDir(path: string | undefined, kind?: string): string {
  if (kind !== 'file' && kind !== 'diff' && kind !== 'commitDiff') return ''
  if (path === undefined || path === '') return ''
  const slash = path.replace(/\\/g, '/').lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function sanitizeTermId(value: unknown): string {
  if (typeof value !== 'string') return 'main'
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 64) return 'main'
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return 'main'
  return trimmed
}

export function termSessionKey(workspaceId: string, termId?: string): string {
  return `${workspaceId}::${sanitizeTermId(termId)}`
}

export function termIdFromTabId(tabId: string): string {
  if (!tabId.startsWith('terminal:')) return 'main'
  return sanitizeTermId(tabId.slice('terminal:'.length))
}

/** Join a folder and a file name. Rejects `..` and empty names. */
export function joinWorkspaceFile(dir: string, name: string): string | null {
  const folder = dir.trim().replace(/\\/g, '/')
  const file = name.trim().replace(/\\/g, '/')
  if (file === '') return null
  const parts = [...folder.split('/'), ...file.split('/')].filter(part => part !== '' && part !== '.')
  if (parts.length === 0) return null
  if (parts.some(part => part === '..' || part.includes('\0') || /[<>:"|?*]/.test(part))) return null
  return parts.join('/')
}