import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  normalizeDefaults,
  validateCustomList,
  type BuiltinDefaults,
  type CustomSlashCommand,
} from '../../shared/ultra-slash/catalog.ts'

export const STORE_VERSION = 1
export const STORE_RELATIVE_DIR = 'ultra-slash'
export const STORE_FILE_NAME = 'commands.json'

export interface CustomCommandStoreFile {
  readonly version: number
  readonly commands: readonly CustomSlashCommand[]
  readonly defaults?: Readonly<BuiltinDefaults>
}

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

export function customCommandStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), STORE_RELATIVE_DIR, STORE_FILE_NAME)
}

export class StoreError extends Error {
  constructor(
    readonly code: 'corrupt' | 'io',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'StoreError'
  }
}

function isCommandShape(value: unknown): value is { name: string; description?: string; steerText: string } {
  if (typeof value !== 'object' || value === null) return false
  const row = value as { name?: unknown; description?: unknown; steerText?: unknown }
  return typeof row.name === 'string' && typeof row.steerText === 'string'
    && (row.description === undefined || typeof row.description === 'string')
}

function parseStoreFile(raw: string): { commands: CustomSlashCommand[]; defaults: BuiltinDefaults } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new StoreError('corrupt', 'commands.json is not valid JSON', { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreError('corrupt', 'commands.json must be an object')
  }
  const body = parsed as { version?: unknown; commands?: unknown; defaults?: unknown }
  if (!Array.isArray(body.commands)) {
    throw new StoreError('corrupt', 'commands.json is missing a commands array')
  }
  const rows = body.commands
  if (!rows.every(isCommandShape)) {
    throw new StoreError('corrupt', 'commands.json contains an invalid command row')
  }
  const validated = validateCustomList(rows)
  if (!validated.ok) {
    throw new StoreError('corrupt', 'commands.json failed validation: ' + validated.issue.code)
  }
  const defaults = normalizeDefaults(
    typeof body.defaults === 'object' && body.defaults !== null && !Array.isArray(body.defaults)
      ? body.defaults as Record<string, unknown>
      : undefined,
  )
  return { commands: validated.commands, defaults }
}

/** Missing file → empty list. Corrupt file throws so a save cannot wipe it. */
export async function loadCustomCommands(path: string): Promise<CustomSlashCommand[]> {
  return (await loadUltraSlashStore(path)).commands
}

/** Missing file → empty defaults. Corrupt file throws so a save cannot wipe it. */
export async function loadBuiltinDefaults(path: string): Promise<BuiltinDefaults> {
  return (await loadUltraSlashStore(path)).defaults
}

/** Parse the whole store file (custom commands + configured builtin defaults). */
export async function loadUltraSlashStore(
  path: string,
): Promise<{ commands: CustomSlashCommand[]; defaults: BuiltinDefaults }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) return { commands: [], defaults: {} }
    throw new StoreError('io', 'could not read ' + path, { cause: error })
  }
  if (raw.trim().length === 0) return { commands: [], defaults: {} }
  return parseStoreFile(raw)
}

export async function saveCustomCommands(
  path: string,
  commands: readonly CustomSlashCommand[],
  defaults: Readonly<BuiltinDefaults> = {},
): Promise<void> {
  const body: CustomCommandStoreFile = {
    version: STORE_VERSION,
    commands,
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
  }
  const json = JSON.stringify(body, null, 2) + '\n'
  // Unique tmp name per write: two writers (e.g. this plugin and a leftover
  // standalone ultra-slash install sharing the same store file in one process)
  // must never collide on the rename target, or the loser gets ENOENT.
  const tmp = path + '.' + process.pid + '.' + randomUUID() + '.tmp'
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, json, 'utf8')
    await rename(tmp, path)
  } catch (error: unknown) {
    throw new StoreError('io', 'could not write ' + path, { cause: error })
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code: unknown }).code === 'ENOENT'
}
