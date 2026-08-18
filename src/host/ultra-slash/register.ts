/**
 * Host command registrations: builtins plus the user-defined `/steer` aliases
 * persisted under `$DSH_HOME/ultra-slash/commands.json`.
 */

import {
  BUILTIN_SLASH_COMMANDS,
  composeAliasText,
  validateCustomList,
  type CustomSlashCommand,
} from '../../shared/ultra-slash/catalog.ts'
import {
  cancelledSteerResult,
  COMMAND_HINT,
  COMMAND_NAME,
  executeSteer,
  newSessionResult,
} from './command.ts'
import {
  formatCatalogIssue,
  resolveHostLocale,
  translate,
  type UiLocale,
} from '../../shared/ultra-slash/locales.ts'
import type { SteerCommandDefinition, SteerCommandResult, SteerInvocation } from '../../shared/ultra-slash/types.ts'
import {
  customCommandStorePath,
  loadCustomCommands,
  saveCustomCommands,
  StoreError,
} from './store.ts'

export type SaveCustomResult =
  | { readonly ok: true; readonly commands: readonly CustomSlashCommand[] }
  | { readonly ok: false; readonly message: string }

export interface CommandHub {
  listCustom(): readonly CustomSlashCommand[]
  saveCustom(rows: readonly { name: string; description?: string; steerText: string }[]): Promise<SaveCustomResult>
  loadError(): string | undefined
  setLoadError(message: string | undefined): void
}

export interface HubContext {
  get(name: string): unknown
  commands: {
    register(definition: SteerCommandDefinition): () => void
  }
}

function localeOf(ctx: HubContext): UiLocale {
  return resolveHostLocale((name) => ctx.get(name))
}

function aliasHandler(
  ctx: HubContext,
  template: () => string,
): (invocation: SteerInvocation) => SteerCommandResult {
  return (invocation) => executeSteer(
    { ...invocation, rawInput: composeAliasText(template(), invocation.rawInput) },
    localeOf(ctx),
  )
}

function isAlreadyRegistered(error: unknown): boolean {
  return error instanceof Error && /already registered/i.test(error.message)
}

function nameFromRegisterError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const match = /command "([^"]+)" is already registered/i.exec(error.message)
  return match?.[1]
}

function occupiedMessage(locale: UiLocale, name: string, error: unknown): string {
  if (isAlreadyRegistered(error)) {
    return translate(locale, 'catalog.issue.occupied', { name })
  }
  const detail = error instanceof Error && error.message.trim().length > 0
    ? error.message
    : translate(locale, 'steer.unknownError')
  return translate(locale, 'catalog.issue.unknown', { detail })
}

function storeMessage(locale: UiLocale, error: StoreError, path: string): string {
  if (error.code === 'corrupt') {
    return translate(locale, 'catalog.issue.corrupt', { path })
  }
  return translate(locale, 'catalog.issue.io', {
    path,
    detail: error.cause instanceof Error ? error.cause.message : error.message,
  })
}

function registerOne(ctx: HubContext, definition: SteerCommandDefinition): () => void {
  return ctx.commands.register(definition)
}

/** Builtins may already be owned by a leftover ultra-slash plugin; skip instead of crashing workbench load. */
function registerBuiltinOne(ctx: HubContext, definition: SteerCommandDefinition): () => void {
  try {
    return registerOne(ctx, definition)
  } catch (error: unknown) {
    if (isAlreadyRegistered(error)) return () => {}
    throw error
  }
}

function registerCustomRow(
  ctx: HubContext,
  command: CustomSlashCommand,
): () => void {
  return registerOne(ctx, {
    name: command.name,
    description: command.description,
    input: { hint: translate('en', 'alias.hint') },
    handler: aliasHandler(ctx, () => command.steerText),
  })
}

/** Register shipped commands. `/new` only acknowledges; the client switches the session. */
export function registerBuiltinCommands(ctx: HubContext): () => void {
  const undo: Array<() => void> = []
  for (const command of BUILTIN_SLASH_COMMANDS) {
    if (command.kind === 'steer') {
      undo.push(registerBuiltinOne(ctx, {
        name: COMMAND_NAME,
        description: translate('en', 'steer.description'),
        input: { hint: COMMAND_HINT },
        handler: (invocation) => executeSteer(invocation, localeOf(ctx)),
      }))
      continue
    }
    if (command.kind === 'session') {
      undo.push(registerBuiltinOne(ctx, {
        name: command.name,
        description: translate('en', 'new.description'),
        handler: (invocation) => {
          if (invocation.signal.aborted) return cancelledSteerResult(localeOf(ctx))
          return newSessionResult(localeOf(ctx))
        },
      }))
      continue
    }
    const payloadKey = command.payloadKey
    if (payloadKey === undefined) continue
    undo.push(registerBuiltinOne(ctx, {
      name: command.name,
      description: translate('en', command.descriptionKey),
      input: { hint: translate('en', 'alias.hint') },
      handler: aliasHandler(ctx, () => translate(localeOf(ctx), payloadKey)),
    }))
  }
  return () => {
    while (undo.length > 0) undo.pop()?.()
  }
}

/**
 * Load persisted custom commands, keep them registered, and replace the set
 * when the settings page saves.
 */
export function createCommandHub(ctx: HubContext, storePath = customCommandStorePath()): CommandHub {
  let custom: CustomSlashCommand[] = []
  let disposers: Array<() => void> = []

  const replaceLive = (next: CustomSlashCommand[]): void => {
    const previous = custom
    while (disposers.length > 0) disposers.pop()?.()
    try {
      const nextDisposers: Array<() => void> = []
      for (const command of next) {
        nextDisposers.push(registerCustomRow(ctx, command))
      }
      disposers = nextDisposers
      custom = next
    } catch (error: unknown) {
      while (disposers.length > 0) disposers.pop()?.()
      const restored: Array<() => void> = []
      for (const command of previous) {
        restored.push(registerCustomRow(ctx, command))
      }
      disposers = restored
      custom = previous
      throw error
    }
  }

  let queue: Promise<unknown> = Promise.resolve()

  const saveCustomUnlocked = async (
    rows: readonly { name: string; description?: string; steerText: string }[],
  ): Promise<SaveCustomResult> => {
    const locale = localeOf(ctx)
    const validated = validateCustomList(rows)
    if (!validated.ok) {
      return { ok: false, message: formatCatalogIssue(locale, validated.issue) }
    }
    const previous = custom
    try {
      replaceLive(validated.commands)
    } catch (error: unknown) {
      return {
        ok: false,
        message: occupiedMessage(locale, nameFromRegisterError(error) ?? validated.commands[0]?.name ?? '', error),
      }
    }
    try {
      await saveCustomCommands(storePath, validated.commands)
    } catch (error: unknown) {
      replaceLive(previous)
      const storeError = error instanceof StoreError
        ? error
        : new StoreError('io', 'write failed', { cause: error })
      return { ok: false, message: storeMessage(locale, storeError, storePath) }
    }
    return { ok: true, commands: validated.commands }
  }

  let bootError: string | undefined

  const hub: CommandHub = {
    listCustom: () => custom,
    loadError: () => bootError,
    setLoadError(message) {
      bootError = message
    },
    saveCustom(rows) {
      const done = queue.then(async () => {
        const result = await saveCustomUnlocked(rows)
        if (result.ok) bootError = undefined
        return result
      })
      queue = done.then(() => undefined, () => undefined)
      return done
    },
  }

  return hub
}

export async function loadHubFromDisk(hub: CommandHub, storePath = customCommandStorePath()): Promise<SaveCustomResult> {
  try {
    const commands = await loadCustomCommands(storePath)
    const result = await hub.saveCustom(commands)
    if (!result.ok) hub.setLoadError(result.message)
    return result
  } catch (error: unknown) {
    const locale = 'zh'
    const message = error instanceof StoreError
      ? storeMessage(locale, error, storePath)
      : translate(locale, 'catalog.issue.unknown', {
        detail: error instanceof Error ? error.message : String(error),
      })
    hub.setLoadError(message)
    return { ok: false, message }
  }
}

/** Register shipped commands. Tests can call this without touching the store. */
export function applyCommands(ctx: HubContext): void {
  registerBuiltinCommands(ctx)
}
