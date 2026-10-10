import { randomUUID } from 'node:crypto'
import { constants, link, mkdir, open, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { GitError } from '../../shared/errors.ts'
import { resolveInsideRoot } from './paths.ts'

/** Uploads stream straight to disk, so they are not bound by the editor's 1.5 MB text cap. */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024

export interface UploadResult {
  path: string
  size: number
}

async function streamToDisk(target: FileHandle, req: IncomingMessage): Promise<number> {
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_UPLOAD_BYTES) throw new GitError('FS_TOO_LARGE')
      await target.write(chunk)
    }
  } catch (error) {
    if (error instanceof GitError) throw error
    // Premature close, aborted request, or a disk failure: nothing half-written stays behind.
    throw new GitError('FS_WRITE_FAILED')
  }
  return size
}

/**
 * Stream one upload into a temp file inside the destination directory, then
 * commit it with `link` so the name appears atomically and an existing name is
 * never overwritten.
 */
export async function uploadFile(req: IncomingMessage, root: string, path: string): Promise<UploadResult> {
  const declared = Number(req.headers['content-length'] ?? '')
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) throw new GitError('FS_TOO_LARGE')
  const name = basename(path)
  if (name === '' || name === '.' || name === '..') throw new GitError('INVALID_PATH')
  const parent = dirname(path)
  const dir = await resolveInsideRoot(root, parent === '.' ? '' : parent)
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    throw new GitError('FS_WRITE_FAILED')
  }
  const destination = join(dir, name)
  const temp = join(dir, `.dsh-upload-${randomUUID()}.tmp`)
  let handle: FileHandle
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  } catch {
    throw new GitError('FS_WRITE_FAILED')
  }
  try {
    const size = await streamToDisk(handle, req)
    await handle.close()
    try {
      await link(temp, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new GitError('FS_EXISTS')
      throw new GitError('FS_WRITE_FAILED')
    }
    return { path, size }
  } finally {
    await unlink(temp).catch(() => {})
  }
}
