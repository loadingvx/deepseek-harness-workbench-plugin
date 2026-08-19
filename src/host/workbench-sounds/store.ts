/**
 * Sound index store: reads/writes ~/.dsh/workbench-sounds/index.json
 * and manages the custom/ audio files.
 */

import { mkdir, readFile, rename, stat, writeFile, unlink, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import type { SoundEntry, SoundIndex } from '../../shared/workbench-sounds/types.ts'
import { MAX_SOUND_UPLOAD_BYTES } from '../../shared/workbench-sounds/types.ts'

export const STORE_VERSION = 1 as const
export const STORE_RELATIVE_DIR = 'workbench-sounds'
export const STORE_INDEX_FILE = 'index.json'
export const STORE_CUSTOM_DIR = 'custom'

function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

export function soundsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), STORE_RELATIVE_DIR)
}

export function soundsIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(soundsDir(env), STORE_INDEX_FILE)
}

export function soundsCustomDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(soundsDir(env), STORE_CUSTOM_DIR)
}

/** MIME type from extension. */
export function mimeFromExt(filename: string): string {
  const ext = extname(filename).toLowerCase()
  switch (ext) {
    case '.ogg': return 'audio/ogg'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.webm': return 'audio/webm'
    case '.m4a': return 'audio/mp4'
    case '.flac': return 'audio/flac'
    default: return 'application/octet-stream'
  }
}

function isValidMime(mime: string): boolean {
  return ['audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/flac'].includes(mime)
}

function isEntryShape(v: unknown): v is SoundEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return typeof e.id === 'string' && typeof e.name === 'string' && typeof e.nameZh === 'string'
    && typeof e.kind === 'string' && (e.kind === 'builtin' || e.kind === 'custom')
    && typeof e.url === 'string' && typeof e.mimeType === 'string'
}

function parseIndex(raw: string): SoundIndex {
  const parsed = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('index.json must be an object')
  const body = parsed as Record<string, unknown>
  if (typeof body.version !== 'number') throw new Error('index.json missing version')
  const custom = Array.isArray(body.custom) ? body.custom.filter(isEntryShape) : []
  return { version: body.version as number, custom }
}

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'ENOENT'
}

/** Load sound index. Missing file → empty custom list. */
export async function loadSoundIndex(env: NodeJS.ProcessEnv = process.env): Promise<SoundIndex> {
  const path = soundsIndexPath(env)
  try {
    const raw = await readFile(path, 'utf8')
    if (raw.trim() === '') return { version: STORE_VERSION, custom: [] }
    return parseIndex(raw)
  } catch (e) {
    if (isNotFound(e)) return { version: STORE_VERSION, custom: [] }
    throw e
  }
}

/** Save sound index. */
export async function saveSoundIndex(index: SoundIndex, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = soundsIndexPath(env)
  const json = `${JSON.stringify(index, null, 2)}\n`
  const tmp = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmp, json, 'utf8')
  await rename(tmp, path)
}

/** Add a custom sound from a buffer. Returns the new entry. */
export async function addCustomSound(
  buffer: Buffer,
  filename: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SoundEntry> {
  const mime = mimeFromExt(filename)
  if (!isValidMime(mime)) throw new Error(`Unsupported audio format: ${mime}`)
  if (buffer.length > MAX_SOUND_UPLOAD_BYTES) throw new Error(`File too large (max ${MAX_SOUND_UPLOAD_BYTES / 1024 / 1024}MB)`)
  if (buffer.length === 0) throw new Error('Empty file')

  const customDir = soundsCustomDir(env)
  await mkdir(customDir, { recursive: true })

  // Preserve extension
  const ext = extname(filename)
  const filepath = join(customDir, `${id}${ext}`)
  await writeFile(filepath, buffer)

  const entry: SoundEntry = {
    id,
    name: filename.replace(/\.[^.]+$/, ''),
    nameZh: filename.replace(/\.[^.]+$/, ''),
    kind: 'custom',
    url: `${id}${ext}`,
    filename,
    mimeType: mime,
    size: buffer.length,
  }

  const index = await loadSoundIndex(env)
  // Remove existing entry with same id if any
  index.custom = index.custom.filter(e => e.id !== id)
  index.custom.push(entry)
  await saveSoundIndex(index, env)

  return entry
}

/** Delete a custom sound by ID. */
export async function deleteCustomSound(id: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const index = await loadSoundIndex(env)
  const entry = index.custom.find(e => e.id === id)
  if (!entry) return

  // Delete file
  const customDir = soundsCustomDir(env)
  const filepath = join(customDir, entry.url)
  try { await unlink(filepath) } catch { /* ignore if already gone */ }

  // Update index
  index.custom = index.custom.filter(e => e.id !== id)
  await saveSoundIndex(index, env)
}

/** List all custom sound files on disk. */
export async function listCustomSoundFiles(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const customDir = soundsCustomDir(env)
  try {
    const files = await readdir(customDir)
    return files.filter(f => isValidMime(mimeFromExt(f)))
  } catch {
    return []
  }
}

/** Get file path for a custom sound ID. Returns null if not found. */
export async function getCustomSoundPath(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const index = await loadSoundIndex(env)
  const entry = index.custom.find(e => e.id === id)
  if (!entry) return null
  const customDir = soundsCustomDir(env)
  const filepath = join(customDir, entry.url)
  try {
    await stat(filepath)
    return filepath
  } catch {
    return null
  }
}
