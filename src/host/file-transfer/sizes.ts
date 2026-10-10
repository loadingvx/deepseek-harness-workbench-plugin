import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GitError } from '../../shared/errors.ts'
import { resolveInsideRoot } from './paths.ts'

/** A listing answers for one folder, and a folder this large is not worth labelling row by row. */
const MAX_SIZE_ENTRIES = 2000

export interface FileSize {
  name: string
  size: number
}

export interface FileSizeListing {
  path: string
  entries: FileSize[]
  truncated: boolean
}

/**
 * Sizes of the files directly inside one workspace folder.
 *
 * The Files tab lists rows without sizes, so the browser asks per folder it actually shows.
 * Folders are left out: their size would mean walking the whole subtree for a label.
 */
export async function listFileSizes(root: string, path: string): Promise<FileSizeListing> {
  const dir = await resolveInsideRoot(root, path)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new GitError('FS_NOT_FOUND')
    if (code === 'ENOTDIR') throw new GitError('FS_IS_DIRECTORY')
    throw new GitError('FS_WRITE_FAILED')
  }
  const truncated = names.length > MAX_SIZE_ENTRIES
  const entries: FileSize[] = []
  for (const name of names.slice(0, MAX_SIZE_ENTRIES)) {
    try {
      const info = await stat(join(dir, name))
      if (!info.isFile()) continue
      entries.push({ name, size: info.size })
    } catch {
      // The entry disappeared mid-listing; a missing label is better than a failed request.
    }
  }
  return { path, entries, truncated }
}
