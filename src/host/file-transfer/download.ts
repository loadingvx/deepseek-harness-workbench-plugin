import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ServerResponse } from 'node:http'
import { GitError } from '../../shared/errors.ts'
import { resolveInsideRoot } from './paths.ts'

/** ASCII fallback plus the RFC 5987 UTF-8 form, so non-ASCII names survive every browser. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Pump an fd to the response with backpressure.
 * `FileHandle.readable` only exists on Node 23+, and this plugin supports 22.19+.
 */
async function pump(handle: FileHandle, res: ServerResponse): Promise<void> {
  const buffer = Buffer.alloc(1024 * 1024)
  for (;;) {
    if (res.writableEnded || res.destroyed) return
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) return
    if (res.write(buffer.subarray(0, bytesRead))) continue
    await new Promise<void>((resolve, reject) => {
      const onDrain = (): void => { res.off('close', onClose); resolve() }
      const onClose = (): void => { res.off('drain', onDrain); reject(new Error('client disconnected')) }
      res.once('drain', onDrain)
      res.once('close', onClose)
    })
  }
}
/** Stream one workspace file to the client; directories are rejected here, zip packaging has its own route. */
export async function downloadFile(res: ServerResponse, root: string, path: string): Promise<void> {
  const target = await resolveInsideRoot(root, path)
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new GitError('FS_NOT_FOUND')
    throw new GitError('FS_WRITE_FAILED')
  }
  if (info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')
  let handle
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new GitError('FS_NOT_FOUND')
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/octet-stream')
  res.setHeader('content-disposition', contentDisposition(basename(target)))
  res.setHeader('content-length', String(info.size))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  try {
    await pump(handle, res)
    if (!res.writableEnded) res.end()
  } catch {
    res.destroy()
  } finally {
    await handle.close().catch(() => {})
  }
}
