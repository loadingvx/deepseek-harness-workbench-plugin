import type { CustomSlashCommand } from '../../shared/ultra-slash/catalog.ts'
import { translate } from '../../shared/ultra-slash/locales.ts'

export const CUSTOM_COMMANDS_URL = '/ultra-slash/commands'

export type CatalogApiResult =
  | { readonly ok: true; readonly commands: readonly CustomSlashCommand[]; readonly warning?: string }
  | { readonly ok: false; readonly message: string }

function failMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return translate('zh', 'catalog.issue.unknown', { detail: error.message })
  }
  return translate('zh', 'catalog.issue.network')
}

async function readResult(response: Response): Promise<CatalogApiResult> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { ok: false, message: translate('zh', 'catalog.issue.network') }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, message: translate('zh', 'catalog.issue.network') }
  }
  const body = data as {
    ok?: unknown
    message?: unknown
    value?: { commands?: unknown; warning?: unknown }
    commands?: unknown
  }
  if (body.ok === true) {
    const rows = Array.isArray(body.value?.commands)
      ? body.value.commands
      : Array.isArray(body.commands) ? body.commands : []
    const commands: CustomSlashCommand[] = []
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const item = row as { name?: unknown; description?: unknown; steerText?: unknown }
      if (typeof item.name !== 'string' || typeof item.steerText !== 'string') continue
      commands.push({
        name: item.name,
        steerText: item.steerText,
        description: typeof item.description === 'string' ? item.description : item.steerText,
      })
    }
    return { ok: true, commands, ...(typeof body.value?.warning === 'string' ? { warning: body.value.warning } : {}) }
  }
  const message = typeof body.message === 'string' && body.message.trim().length > 0
    ? body.message
    : translate('zh', 'catalog.issue.network')
  return { ok: false, message }
}

export async function fetchCustomCommands(): Promise<CatalogApiResult> {
  try {
    const response = await fetch(CUSTOM_COMMANDS_URL, {
      headers: { accept: 'application/json' },
    })
    return await readResult(response)
  } catch (error: unknown) {
    return { ok: false, message: failMessage(error) }
  }
}

export async function putCustomCommands(
  commands: readonly CustomSlashCommand[],
): Promise<CatalogApiResult> {
  try {
    const response = await fetch(CUSTOM_COMMANDS_URL, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ commands }),
    })
    return await readResult(response)
  } catch (error: unknown) {
    return { ok: false, message: failMessage(error) }
  }
}

/** In-memory custom-command list shared by the `/` menu and the settings page. */
export function createCatalogCache(): {
  list(): readonly CustomSlashCommand[]
  subscribe(listener: () => void): () => void
  refresh(): Promise<CatalogApiResult>
  save(commands: readonly CustomSlashCommand[]): Promise<CatalogApiResult>
} {
  let commands: CustomSlashCommand[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    list: () => commands,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async refresh() {
      const result = await fetchCustomCommands()
      if (result.ok) {
        commands = [...result.commands]
        notify()
      }
      return result
    },
    async save(next) {
      const result = await putCustomCommands(next)
      if (result.ok) {
        commands = [...result.commands]
        notify()
      }
      return result
    },
  }
}

export type CatalogCache = ReturnType<typeof createCatalogCache>
