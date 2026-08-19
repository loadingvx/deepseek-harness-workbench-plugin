import { existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { vendorAssetId, type VendorJsFile } from '../shared/vendor-assets.ts'

interface VendorCache {
  raw: Buffer
  gzip: Buffer
  etag: string
}

const cache = new Map<string, VendorCache>()

export function vendorDirFrom(moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl))
  const nextToBundle = join(here, 'vendor')
  const fromSource = join(here, '..', '..', 'lib', 'vendor')
  if (existsSync(join(nextToBundle, 'mermaid.js'))) return nextToBundle
  if (existsSync(join(fromSource, 'mermaid.js'))) return fromSource
  return nextToBundle
}

function etagOf(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`
}

async function loadVendor(dir: string, name: VendorJsFile): Promise<VendorCache | undefined> {
  const file = join(dir, name)
  if (!existsSync(file)) return undefined
  const stat = statSync(file)
  const etag = etagOf(stat.size, stat.mtimeMs)
  const key = `${dir}\0${name}`
  const hit = cache.get(key)
  if (hit !== undefined && hit.etag === etag) return hit
  const raw = await readFile(file)
  const gzip = gzipSync(raw, { level: 6 })
  const next = { raw, gzip, etag }
  cache.set(key, next)
  return next
}

function wantsGzip(req: IncomingMessage): boolean {
  const header = req.headers['accept-encoding']
  const value = Array.isArray(header) ? header.join(',') : header
  return typeof value === 'string' && /\bgzip\b/i.test(value)
}

/** Serves `/git/vendor/mermaid.js`. Returns false when the path is not a vendor route. */
export async function sendVendorAsset(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  dir: string,
): Promise<boolean> {
  const name = vendorAssetId(pathname)
  if (name === undefined) return false
  const asset = await loadVendor(dir, name)
  if (asset === undefined) {
    res.statusCode = 404
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end('找不到该脚本。请重新构建插件后再打开工作台。')
    return true
  }
  const inm = req.headers['if-none-match']
  if (typeof inm === 'string' && inm === asset.etag) {
    res.statusCode = 304
    res.setHeader('etag', asset.etag)
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.end()
    return true
  }
  const gzip = wantsGzip(req)
  const body = gzip ? asset.gzip : asset.raw
  res.statusCode = 200
  res.setHeader('content-type', 'text/javascript; charset=utf-8')
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  res.setHeader('etag', asset.etag)
  res.setHeader('vary', 'accept-encoding')
  if (gzip) res.setHeader('content-encoding', 'gzip')
  res.setHeader('content-length', String(body.length))
  res.end(body)
  return true
}
