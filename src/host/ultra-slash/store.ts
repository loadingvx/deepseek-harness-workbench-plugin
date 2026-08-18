import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  validateCustomList,
  type CustomSlashCommand,
} from '../../shared/ultra-slash/catalog.ts'

export const STORE_VERSION = 1
export const STORE_RELATIVE_DIR = 'ultra-slash'
export const STORE_FILE_NAME = 'commands.json'

export interface CustomCommandStoreFile {
  readonly version: number
  readonly commands: readonly CustomSlashCommand[]
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

function parseStoreFile(raw: string): CustomSlashCommand[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new StoreError('corrupt', 'commands.json is not valid JSON', { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreError('corrupt', 'commands.json must be an object')
  }
  const body = parsed as { version?: unknown; commands?: unknown }
  if (!Array.isArray(body.commands)) {
    throw new StoreError('corrupt', 'commands.json is missing a commands array')
  }
  const rows = body.commands
  if (!rows.every(isCommandShape)) {
    throw new StoreError('corrupt', 'commands.json contains an invalid command row')
  }
  const validated = validateCustomList(rows)
  if (!validated.ok) {
    throw new StoreError('corrupt', `commands.json failed validation: ${validated.issue.code}`)
  }
  return validated.commands
}

/** Missing file → empty list. Corrupt file throws so a save cannot wipe it. */
export async function loadCustomCommands(path: string): Promise<CustomSlashCommand[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) return []
    throw new StoreError('io', `could not read ${path}`, { cause: error })
  }
  if (raw.trim().length === 0) return []
  return parseStoreFile(raw)
}

export async function saveCustomCommands(
  path: string,
  commands: readonly CustomSlashCommand[],
): Promise<void> {
  const body: CustomCommandStoreFile = { version: STORE_VERSION, commands }
  const json = `${JSON.stringify(body, null, 2)}\n`
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, json, 'utf8')
    await rename(tmp, path)
  } catch (error: unknown) {
    throw new StoreError('io', `could not write ${path}`, { cause: error })
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code: unknown }).code === 'ENOENT'
}
