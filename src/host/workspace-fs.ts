import { cp, mkdir, readdir, readFile, realpath, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, resolve as resolvePath, sep } from 'node:path'
import { GitError } from '../shared/errors.ts'
import { entryMatchesFilter, MAX_SEARCH_HITS, normalizeFileFilter, shouldSkipSearchDir } from '../shared/file-filter.ts'
import { attachIgnored, ignoredPathSet } from './git-ignore.ts'
import type { FsCopyResult, FsDeleteResult, FsDirEntry, FsFileSnapshot, FsListSnapshot, FsMkdirResult, FsRenameResult, FsSearchSnapshot, FsWriteResult } from '../shared/types.ts'

export const MAX_FILE_BYTES = 1_500_000
/** Images may be larger than text buffers; cap at 8 MB to protect the server and browser. */
export const MAX_IMAGE_BYTES = 8_000_000
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

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/** Map an image file to a MIME type, validating magic bytes so text can never be served as an image. */
function imageMimeOf(path: string, buffer: Buffer): string | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.svg') {
    const sample = buffer.subarray(0, 512).toString('utf8').trimStart()
    return sample.startsWith('<?xml') || sample.startsWith('<svg') || sample.startsWith('<') ? 'image/svg+xml' : null
  }
  const mime = IMAGE_EXT_MIME[ext]
  if (mime === undefined) return null
  if (mime === 'image/png') {
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(magic) ? mime : null
  }
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? mime : null
  }
  if (mime === 'image/gif') {
    return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8' ? mime : null
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? mime : null
  }
  if (mime === 'image/avif') {
    return buffer.length >= 12 && buffer.toString('ascii', 4, 12) === 'ftypavif' ? mime : null
  }
  if (mime === 'image/x-icon') {
    return buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0 ? mime : null
  }
  if (mime === 'image/bmp') {
    return buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d ? mime : null
  }
  return null
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
          ignored: false,
        })
      } catch {
        // Dangling symlink or unreadable entry: skip rather than fail the folder.
      }
    }
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, 'zh')
    })
    return { path: rel, entries: await attachIgnored(root, entries), truncated }
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
            hits.push({ name, path, kind, hidden, ignored: false })
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
    return { query: q, hits: await attachIgnored(root, hits), truncated }
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
    const ignored = (await ignoredPathSet(root, [rel])).has(rel)
    return { path: rel, content: buffer.toString('utf8'), size: buffer.length, language: languageOf(rel), ignored }
  }

  /** Read a workspace image as raw bytes. Rejects non-images, directories, and files over the image cap. */
  async readImage(root: string, filePath: string): Promise<{ buffer: Buffer; mime: string }> {
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
    if (info.size > MAX_IMAGE_BYTES) throw new GitError('FS_TOO_LARGE')
    let buffer: Buffer
    try {
      buffer = await readFile(abs)
    } catch (error) {
      if (isPermission(error)) throw new GitError('FS_WRITE_FAILED')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }
    const mime = imageMimeOf(rel, buffer)
    if (mime === null) throw new GitError('FS_BINARY')
    return { buffer, mime }
  }

  /**
   * Read a spreadsheet / delimited-text file (xlsx, csv, tsv) as raw bytes
   * for in-browser table preview. Validates the container so arbitrary
   * workspace files cannot be served as data.
   */
  async readData(root: string, filePath: string): Promise<{ buffer: Buffer; mime: string }> {
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
    if (info.size > MAX_IMAGE_BYTES) throw new GitError('FS_TOO_LARGE')
    let buffer: Buffer
    try {
      buffer = await readFile(abs)
    } catch (error) {
      if (isPermission(error)) throw new GitError('FS_WRITE_FAILED')
      throw new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
    }
    const ext = extname(rel).toLowerCase()
    if (ext === '.xlsx') {
      const magic = Buffer.from([0x50, 0x4b, 0x03, 0x04])
      if (buffer.length < 4 || !buffer.subarray(0, 4).equals(magic)) throw new GitError('FS_BINARY')
      return { buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    }
    const mime = ext === '.csv'
      ? 'text/csv; charset=utf-8'
      : ext === '.tsv'
        ? 'text/tab-separated-values; charset=utf-8'
        : null
    if (mime === null) throw new GitError('FS_BINARY')
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
    if (sample.includes(0)) throw new GitError('FS_BINARY')
    return { buffer, mime }
  }

  /** Rename or move a workspace entry (file or folder). Rejects names that already exist or paths inside the source itself. */
  async rename(root: string, fromPath: string, toPath: string): Promise<FsRenameResult> {
    const fromRel = assertSafeWorkspacePath(root, fromPath)
    const toRel = assertSafeWorkspacePath(root, toPath)
    if (fromRel === '' || toRel === '') throw new GitError('INVALID_PATH')
    if (fromRel === toRel) throw new GitError('FS_EXISTS')
    const inside = toRel === fromRel || toRel.startsWith(fromRel + '/')
    if (inside) throw new GitError('INVALID_PATH')
    const fromAbs = await resolveInside(root, fromRel)
    const toAbs = await resolveInside(root, toRel)
    let target
    try {
      target = await stat(toAbs)
    } catch (error) {
      if (!isNotFound(error)) throw new GitError('FS_RENAME_FAILED')
    }
    if (target !== undefined) throw new GitError('FS_EXISTS')
    try {
      await fsRename(fromAbs, toAbs)
    } catch (error) {
      if (error instanceof GitError) throw error
      throw new GitError('FS_RENAME_FAILED', error instanceof Error ? error.message : undefined)
    }
    return { path: toPosix(toRel) }
  }

  /** Delete a workspace entry (file or folder, recursively). */
  async delete(root: string, filePath: string): Promise<FsDeleteResult> {
    const rel = assertSafeWorkspacePath(root, filePath)
    if (rel === '') throw new GitError('INVALID_PATH')
    const abs = await resolveInside(root, rel)
    try {
      await rm(abs, { recursive: true, force: false })
    } catch (error) {
      if (isNotFound(error)) throw new GitError('FS_NOT_FOUND')
      if (error instanceof GitError) throw error
      throw new GitError('FS_DELETE_FAILED', error instanceof Error ? error.message : undefined)
    }
    return { path: toPosix(rel) }
  }

  /** Create an empty folder. Parent must already exist. Rejects names that already exist. */
  async mkdir(root: string, dirPath: string): Promise<FsMkdirResult> {
    const rel = assertSafeWorkspacePath(root, dirPath)
    if (rel === '') throw new GitError('INVALID_PATH')
    const abs = await resolveInside(root, rel)
    try {
      await stat(abs)
      throw new GitError('FS_EXISTS')
    } catch (error) {
      if (error instanceof GitError) throw error
      if (!isNotFound(error)) throw new GitError('FS_MKDIR_FAILED')
    }
    try {
      await mkdir(abs, { recursive: false })
    } catch (error) {
      if (isNotFound(error)) throw new GitError('FS_NOT_FOUND')
      if (error instanceof GitError) throw error
      throw new GitError('FS_MKDIR_FAILED', error instanceof Error ? error.message : undefined)
    }
    return { path: toPosix(rel) }
  }

  /** Copy a file or folder to a new workspace path. Destination must not exist. */
  async copy(root: string, fromPath: string, toPath: string): Promise<FsCopyResult> {
    const fromRel = assertSafeWorkspacePath(root, fromPath)
    const toRel = assertSafeWorkspacePath(root, toPath)
    if (fromRel === '' || toRel === '') throw new GitError('INVALID_PATH')
    if (fromRel === toRel) throw new GitError('FS_EXISTS')
    if (toRel === fromRel || toRel.startsWith(fromRel + '/')) throw new GitError('INVALID_PATH')
    const fromAbs = await resolveInside(root, fromRel)
    const toAbs = await resolveInside(root, toRel)
    try {
      await stat(fromAbs)
    } catch (error) {
      if (isNotFound(error)) throw new GitError('FS_NOT_FOUND')
      throw new GitError('FS_COPY_FAILED')
    }
    try {
      const target = await stat(toAbs)
      if (target !== undefined) throw new GitError('FS_EXISTS')
    } catch (error) {
      if (error instanceof GitError) throw error
      if (!isNotFound(error)) throw new GitError('FS_COPY_FAILED')
    }
    try {
      await cp(fromAbs, toAbs, { recursive: true, errorOnExist: true, force: false })
    } catch (error) {
      if (error instanceof GitError) throw error
      throw new GitError('FS_COPY_FAILED', error instanceof Error ? error.message : undefined)
    }
    return { path: toPosix(toRel) }
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