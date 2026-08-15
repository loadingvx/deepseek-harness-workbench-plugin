import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, resolve as resolvePath, sep } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { entryMatchesFilter, MAX_SEARCH_HITS, normalizeFileFilter, shouldSkipSearchDir } from '../shared/file-filter.ts'
import type { FsDirEntry, FsFileSnapshot, FsListSnapshot, FsSearchSnapshot, FsWriteResult } from '../shared/types.ts'

export const MAX_FILE_BYTES = 1_500_000
const MAX_DIR_ENTRIES = 400
const MAX_SEARCH_VISITS = 4000

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.wasm', '.so', '.dylib', '.dll', '.exe', '.bin', '.class',
  '.mp3', '.mp4', '.mov', '.wav', '.avi', '.mkv', '.webm',
  '.sqlite', '.db', '.lock',
])

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.toml': 'toml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.vue': 'vue',
  '.svelte': 'svelte',
}

/** Jail a user path to the workspace root. Empty / `.` means the root itself. */
export function assertSafeWorkspacePath(root: string, filePath: string): string {
  const trimmed = filePath.trim()
  if (trimmed.startsWith('-')) throw new GitError('INVALID_PATH')
  const input = trimmed === '' || trimmed === '.' ? '' : trimmed
  const resolved = resolvePath(root, input)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || normalize(rel).split(sep).includes('..')) {
    throw new GitError('INVALID_PATH')
  }
  return rel.split('\\').join('/')
}

async function resolveInside(root: string, rel: string): Promise<string> {
  const full = rel === '' ? root : join(root, rel)
  let real: string
  try {
    real = await realpath(full)
  } catch (error) {
    if (isNotFound(error)) {
      if (rel === '') throw new GitError('FS_NOT_FOUND')
      const parent = dirname(full)
      try {
        const parentReal = await realpath(parent)
        const parentRel = relative(root, parentReal)
        if (parentRel.startsWith('..')) throw new GitError('INVALID_PATH')
        return join(parentReal, rel.split('/').pop() ?? '')
      } catch (inner) {
        if (inner instanceof GitError) throw inner
        throw new GitError('FS_NOT_FOUND')
      }
    }
    throw new GitError('INVALID_PATH')
  }
  const escaped = relative(root, real)
  if (escaped.startsWith('..')) throw new GitError('INVALID_PATH')
  return real
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isPermission(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EACCES'
}

function looksBinary(buffer: Buffer, path: string): boolean {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return true
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  return sample.includes(0)
}

function languageOf(path: string): string {
  return LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? 'plaintext'
}

function toPosix(rel: string): string {
  return rel.split('\\').join('/')
}

/** Workspace-rooted directory listing and text file IO. */
export class WorkspaceFs {
  async list(root: string, dirPath = ''): Promise<FsListSnapshot> {
    const rel = assertSafeWorkspacePath(root, dirPath)
    const abs = await resolveInside(root, rel)
    let info
    try {
      info = await stat(abs)
    } catch (error) {
      if (isNotFound(error)) throw new GitError('FS_NOT_FOUND')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }
    if (!info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')

    let names: string[]
    try {
      names = await readdir(abs)
    } catch (error) {
      if (isPermission(error)) throw new GitError('GIT_FAILED', '没有权限读取这个文件夹。')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }

    names.sort((left, right) => left.localeCompare(right, 'zh'))
    const truncated = names.length > MAX_DIR_ENTRIES
    const slice = truncated ? names.slice(0, MAX_DIR_ENTRIES) : names
    const entries: FsDirEntry[] = []
    for (const name of slice) {
      const childRel = rel === '' ? name : `${rel}/${name}`
      const childAbs = join(abs, name)
      try {
        const childReal = await realpath(childAbs)
        if (relative(root, childReal).startsWith('..')) continue
        const childStat = await stat(childReal)
        entries.push({
          name,
          path: toPosix(childRel),
          kind: childStat.isDirectory() ? 'directory' : 'file',
          hidden: name.startsWith('.'),
        })
      } catch {
        // Dangling symlink or unreadable entry: skip rather than fail the folder.
      }
    }
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, 'zh')
    })
    return { path: rel, entries, truncated }
  }

  async search(root: string, query: string, showHidden = false): Promise<FsSearchSnapshot> {
    const q = normalizeFileFilter(query)
    if (q === '') return { query: '', hits: [], truncated: false }
    const absRoot = await resolveInside(root, '')
    const hits: FsDirEntry[] = []
    const queue: string[] = ['']
    let visits = 0
    let truncated = false
    const revealHidden = showHidden || q.startsWith('.')

    while (queue.length > 0) {
      if (hits.length >= MAX_SEARCH_HITS || visits >= MAX_SEARCH_VISITS) {
        truncated = true
        break
      }
      const rel = queue.shift() ?? ''
      const abs = rel === '' ? absRoot : join(absRoot, rel)
      let names: string[]
      try {
        names = await readdir(abs)
      } catch {
        continue
      }
      visits += 1
      for (const name of names) {
        if (hits.length >= MAX_SEARCH_HITS || visits >= MAX_SEARCH_VISITS) {
          truncated = true
          break
        }
        const hidden = name.startsWith('.')
        if (hidden && !revealHidden) continue
        if (shouldSkipSearchDir(name, q)) continue
        const childRel = rel === '' ? name : `${rel}/${name}`
        const childAbs = join(abs, name)
        try {
          const childReal = await realpath(childAbs)
          if (relative(root, childReal).startsWith('..')) continue
          const childStat = await stat(childReal)
          const kind = childStat.isDirectory() ? 'directory' : 'file'
          const path = toPosix(childRel)
          if (entryMatchesFilter(name, path, q)) {
            hits.push({ name, path, kind, hidden })
          }
          if (kind === 'directory') queue.push(childRel)
        } catch {
          // Dangling symlink or unreadable entry: skip.
        }
      }
    }

    hits.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.path.localeCompare(right.path, 'zh')
    })
    return { query: q, hits, truncated }
  }

  async resolveAbsolute(root: string, filePath: string): Promise<string> {
    const rel = assertSafeWorkspacePath(root, filePath)
    return resolveInside(root, rel)
  }

  async read(root: string, filePath: string): Promise<FsFileSnapshot> {
    const rel = assertSafeWorkspacePath(root, filePath)
    if (rel === '') throw new GitError('FS_IS_DIRECTORY')
    const abs = await resolveInside(root, rel)
    let info
    try {
      info = await stat(abs)
    } catch (error) {
      if (isNotFound(error)) throw new GitError('FS_NOT_FOUND')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }
    if (info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')
    if (info.size > MAX_FILE_BYTES) throw new GitError('FS_TOO_LARGE')
    let buffer: Buffer
    try {
      buffer = await readFile(abs)
    } catch (error) {
      if (isPermission(error)) throw new GitError('FS_WRITE_FAILED')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }
    if (looksBinary(buffer, rel)) throw new GitError('FS_BINARY')
    return { path: rel, content: buffer.toString('utf8'), size: buffer.length, language: languageOf(rel) }
  }

  async write(root: string, filePath: string, content: string): Promise<FsWriteResult> {
    const rel = assertSafeWorkspacePath(root, filePath)
    if (rel === '') throw new GitError('FS_IS_DIRECTORY')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new GitError('FS_TOO_LARGE')
    const abs = await resolveInside(root, rel)
    try {
      const info = await stat(abs)
      if (info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')
    } catch (error) {
      if (error instanceof GitError) throw error
      if (!isNotFound(error)) throw new GitError('FS_WRITE_FAILED')
      await mkdir(dirname(abs), { recursive: true })
    }
    try {
      await writeFile(abs, content, 'utf8')
    } catch (error) {
      if (error instanceof GitError) throw error
      throw new GitError('FS_WRITE_FAILED', error instanceof Error ? error.message : undefined)
    }
    return { path: rel, size: Buffer.byteLength(content, 'utf8') }
  }
}
