import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { deflateRawSync } from 'node:zlib'
import { GitError } from '../../shared/errors.ts'
import { contentDisposition } from './download.ts'
import { resolveInsideRoot } from './paths.ts'

export const MAX_ZIP_FILES = 5000
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

export function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31)
  const date = (((d.getFullYear() - 1980) & 127) << 5) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  return { time, date }
}

function localHeader(name: string, method: number, time: number, date: number, crc: number, compSize: number, uncompSize: number): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(0x800, 6) // entry names are UTF-8
  h.writeUInt16LE(method, 8)
  h.writeUInt16LE(time, 10)
  h.writeUInt16LE(date, 12)
  h.writeUInt32LE(crc, 14)
  h.writeUInt32LE(compSize, 18)
  h.writeUInt32LE(uncompSize, 22)
  h.writeUInt16LE(nameBuf.length, 26)
  h.writeUInt16LE(0, 28)
  return Buffer.concat([h, nameBuf])
}

function centralRecord(name: string, method: number, time: number, date: number, crc: number, compSize: number, uncompSize: number, localOffset: number, isDir: boolean): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(20, 6)
  h.writeUInt16LE(0x800, 8)
  h.writeUInt16LE(method, 10)
  h.writeUInt16LE(time, 12)
  h.writeUInt16LE(date, 14)
  h.writeUInt32LE(crc, 16)
  h.writeUInt32LE(compSize, 20)
  h.writeUInt32LE(uncompSize, 24)
  h.writeUInt16LE(nameBuf.length, 28)
  if (isDir) h.writeUInt32LE(0x10, 38) // MS-DOS directory attribute
  h.writeUInt32LE(localOffset, 42)
  return Buffer.concat([h, nameBuf])
}

function endRecord(count: number, cdSize: number, cdOffset: number): Buffer {
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(count, 8)
  e.writeUInt16LE(count, 10)
  e.writeUInt32LE(cdSize, 12)
  e.writeUInt32LE(cdOffset, 16)
  return e
}

async function writeOut(res: ServerResponse, buf: Buffer): Promise<void> {
  if (res.writableEnded || res.destroyed) throw new GitError('FS_WRITE_FAILED')
  if (res.write(buf)) return
  await new Promise<void>((resolve, reject) => {
    const onDrain = (): void => { res.off('close', onClose); resolve() }
    const onClose = (): void => { res.off('drain', onDrain); reject(new GitError('FS_WRITE_FAILED')) }
    res.once('drain', onDrain)
    res.once('close', onClose)
  })
}

interface ZipFile { rel: string; size: number; mtime: Date }

/** Walk one jailed directory. Symlinks and special files are skipped; caps bound the archive. */
async function collectEntries(rootReal: string): Promise<{ files: ZipFile[]; dirs: string[] }> {
  const files: ZipFile[] = []
  const dirs: string[] = []
  const queue: string[] = ['']
  while (queue.length > 0) {
    const rel = queue.pop() as string
    let items
    try {
      items = await readdir(rel === '' ? rootReal : join(rootReal, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of items) {
      const childRel = rel === '' ? item.name : `${rel}/${item.name}`
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) {
        dirs.push(childRel)
        queue.push(childRel)
      } else if (item.isFile()) {
        let info
        try {
          info = await stat(join(rootReal, childRel))
        } catch {
          continue
        }
        files.push({ rel: childRel, size: info.size, mtime: info.mtime })
        if (files.length > MAX_ZIP_FILES) throw new GitError('FS_TOO_LARGE')
      }
    }
  }
  let total = 0
  for (const file of files) {
    total += file.size
    if (total > MAX_ZIP_TOTAL_BYTES) throw new GitError('FS_TOO_LARGE')
  }
  return { files, dirs }
}

/** Package one workspace directory into a streamed zip; empty path means the workspace root itself. */
export async function downloadDirectoryZip(res: ServerResponse, root: string, path: string): Promise<void> {
  const dirAbs = await resolveInsideRoot(root, path)
  let info
  try {
    info = await stat(dirAbs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new GitError('FS_NOT_FOUND')
    throw new GitError('FS_WRITE_FAILED')
  }
  if (!info.isDirectory()) throw new GitError('FS_IS_DIRECTORY')
  const rootReal = await realpath(dirAbs)
  const { files, dirs } = await collectEntries(rootReal)
  const zipName = `${path === '' ? basename(rootReal) : basename(path)}.zip`
  res.statusCode = 200
  res.setHeader('content-type', 'application/zip')
  res.setHeader('content-disposition', contentDisposition(zipName))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const central: Buffer[] = []
  let offset = 0
  for (const dir of dirs) {
    const { time, date } = dosDateTime(info.mtime)
    const header = localHeader(`${dir}/`, 0, time, date, 0, 0, 0)
    await writeOut(res, header)
    offset += header.length
    central.push(centralRecord(`${dir}/`, 0, time, date, 0, 0, 0, offset - header.length, true))
  }
  for (const file of files) {
    let data: Buffer
    try {
      data = await readFile(join(rootReal, file.rel))
    } catch {
      continue // removed while packaging
    }
    const { time, date } = dosDateTime(file.mtime)
    const crc = crc32(data)
    let method = 8
    let payload = deflateRawSync(data, { level: 6 })
    if (payload.length >= data.length) {
      method = 0
      payload = data
    }
    const header = localHeader(file.rel, method, time, date, crc, payload.length, data.length)
    await writeOut(res, header)
    offset += header.length
    if (payload.length > 0) {
      await writeOut(res, payload)
      offset += payload.length
    }
    central.push(centralRecord(file.rel, method, time, date, crc, payload.length, data.length, offset - header.length - payload.length, false))
  }
  const cdStart = offset
  let cdSize = 0
  for (const record of central) {
    await writeOut(res, record)
    cdSize += record.length
  }
  await writeOut(res, endRecord(central.length, cdSize, cdStart))
  res.end()
}
