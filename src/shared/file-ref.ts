/** Official composer chip source. Must match `inputTriggers.registerSource({ name })`. */
export const FILE_REF_SOURCE = 'workbench-file'

export const FILE_REF_TRIGGER = '@' as const

/** File-tree drag payload. Custom type is authoritative; text/plain is the Firefox fallback. */
export const FILE_REF_PATH_TYPE = 'application/x-dsh-path'
export const FILE_REF_KIND_TYPE = 'application/x-dsh-kind'

export type FileRefKind = 'file' | 'directory'

const FILE_PREFIX = 'f:'
const DIR_PREFIX = 'd:'

/** Workspace-relative path, no leading/trailing slash. Rejects `..`. */
export function normalizeRelPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(part => part !== '' && part !== '.')
  if (parts.length === 0) return null
  if (parts.some(part => part === '..' || part.includes('\0'))) return null
  return parts.join('/')
}

export function fileRefBaseName(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash === -1 ? relPath : relPath.slice(slash + 1)
}

/** Official 4em chip still centers short names; longer labels align to the end. */
export const FILE_REF_CHIP_CENTER_MAX = 8

export function fileRefChipAlignEnd(label: string): boolean {
  return [...label].length > FILE_REF_CHIP_CENTER_MAX
}

/** Chip label. Same basename already in the draft becomes `name · 2`. */
export function fileRefLabel(name: string, takenLabels: Iterable<string>): string {
  const used = new Set([...takenLabels].filter(label => label !== ''))
  if (!used.has(name)) return name
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} · ${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${name} · ${Date.now()}`
}

export interface FileRefOccurrence {
  readonly ref?: string
  readonly label?: string
}

/** Same path reuses its label. Only a *different* file with the same name gets `· 2`. */
export function fileRefChipLabel(
  kind: FileRefKind,
  relPath: string,
  existing: ReadonlyArray<FileRefOccurrence>,
): string {
  const ref = encodeFileRef(kind, relPath)
  const reused = existing.find(row => row.ref === ref && row.label !== undefined && row.label !== '')
  if (reused?.label !== undefined) return reused.label
  // Only number when we *know* another chip is a different path. Missing ref
  // must not look like a collision — same file dragged twice often arrives that way.
  const taken = existing
    .filter(row => typeof row.ref === 'string' && row.ref !== '' && row.ref !== ref && row.label !== undefined && row.label !== '')
    .map(row => row.label!)
  return fileRefLabel(fileRefBaseName(relPath), taken)
}

export function encodeFileRef(kind: FileRefKind, relPath: string): string {
  return `${kind === 'directory' ? DIR_PREFIX : FILE_PREFIX}${relPath}`
}

export function parseFileRef(ref: string): { kind: FileRefKind; relPath: string } | null {
  if (ref.startsWith(DIR_PREFIX)) {
    const relPath = normalizeRelPath(ref.slice(DIR_PREFIX.length))
    return relPath === null ? null : { kind: 'directory', relPath }
  }
  if (ref.startsWith(FILE_PREFIX)) {
    const relPath = normalizeRelPath(ref.slice(FILE_PREFIX.length))
    return relPath === null ? null : { kind: 'file', relPath }
  }
  const relPath = normalizeRelPath(ref)
  return relPath === null ? null : { kind: 'file', relPath }
}

/** Model form: relative path; directories keep a trailing slash. */
export function serializeFileRef(ref: string): string {
  const parsed = parseFileRef(ref)
  if (parsed === null) throw new Error(`workbench-file: invalid ref`)
  return parsed.kind === 'directory' ? `${parsed.relPath}/` : parsed.relPath
}

export function clipboardFileRef(ref: string): string {
  return serializeFileRef(ref)
}

export function buildFileReference(
  kind: FileRefKind,
  relPath: string,
  existing: ReadonlyArray<FileRefOccurrence> = [],
): { source: typeof FILE_REF_SOURCE; ref: string; label: string; clipboardText: string } | null {
  const normalized = normalizeRelPath(relPath)
  if (normalized === null) return null
  const ref = encodeFileRef(kind, normalized)
  return {
    source: FILE_REF_SOURCE,
    ref,
    label: fileRefChipLabel(kind, normalized, existing),
    clipboardText: clipboardFileRef(ref),
  }
}
