import { createSteerMessage } from './message.ts'
import {
  COMMAND_NAME,
  DOCS_COMMAND_NAME,
  NEW_COMMAND_NAME,
  PLUGIN_NAME,
  SKILL_COMMAND_NAME,
} from '../../shared/ultra-slash/ids.ts'
import type { SteerCommandResult, SteerInvocation } from '../../shared/ultra-slash/types.ts'
import {
  resolveHostLocale,
  translate,
  type UiLocale,
} from '../../shared/ultra-slash/locales.ts'

export {
  COMMAND_NAME,
  DOCS_COMMAND_NAME,
  NEW_COMMAND_NAME,
  PLUGIN_NAME,
  SKILL_COMMAND_NAME,
}

/** Host catalog copy. DSH built-in commands register English; the `/` menu uses locale dictionaries. */
export const COMMAND_DESCRIPTION = translate('en', 'steer.description')
export const COMMAND_HINT = translate('en', 'steer.hint')

export { resolveHostLocale }

/** Parsed `/steer` input. Empty after trim is a usage error, not a no-op inject. */
export type ParsedSteer =
  | { readonly kind: 'empty' }
  | { readonly kind: 'steer'; readonly text: string }

/** Split the command suffix. Surrounding whitespace is discarded; inner text is kept. */
export function parseSteerInput(rawInput: string): ParsedSteer {
  const text = rawInput.trim()
  if (text.length === 0) return { kind: 'empty' }
  return { kind: 'steer', text }
}

/** Usage error when the user typed `/steer` with nothing to inject. */
export function emptySteerResult(
  locale: UiLocale = 'zh',
): { readonly kind: 'error'; readonly text: string } {
  return {
    kind: 'error',
    text: translate(locale, 'steer.empty', {
      usage: translate(locale, 'steer.usage'),
      example: translate(locale, 'steer.example'),
    }),
  }
}

/** Confirmation after the text has been queued. The injected payload is the full `text`. */
export function queuedSteerResult(
  status: 'idle' | 'running',
  text: string,
  locale: UiLocale = 'zh',
): { readonly kind: 'success'; readonly text: string } {
  const quoted = quoteForNotice(text, locale)
  if (status === 'running') {
    return { kind: 'success', text: translate(locale, 'steer.queued.running', { quoted }) }
  }
  return { kind: 'success', text: translate(locale, 'steer.queued.idle', { quoted }) }
}

/** Notice when the UI aborted the command before anything was queued. */
export function cancelledSteerResult(
  locale: UiLocale = 'zh',
): { readonly kind: 'error'; readonly text: string } {
  return { kind: 'error', text: translate(locale, 'steer.cancelled') }
}

/** Notice when `agent.steer` itself throws. */
export function steerFailedResult(
  error: unknown,
  locale: UiLocale = 'zh',
): { readonly kind: 'error'; readonly text: string } {
  return {
    kind: 'error',
    text: translate(locale, 'steer.failed', { detail: renderThrown(error, locale) }),
  }
}

/** Host `/new` acknowledgment. The client actually switches the visible session. */
export function newSessionResult(
  locale: UiLocale = 'zh',
): { readonly kind: 'success'; readonly text: string } {
  return { kind: 'success', text: translate(locale, 'new.ok') }
}

/** Validate, queue, and acknowledge one `/steer` line. Does not call `cancel()`. */
export function executeSteer(
  invocation: SteerInvocation,
  locale: UiLocale = 'zh',
): SteerCommandResult {
  if (invocation.signal.aborted) return cancelledSteerResult(locale)

  const parsed = parseSteerInput(invocation.rawInput)
  if (parsed.kind === 'empty') return emptySteerResult(locale)

  try {
    invocation.agent.steer(createSteerMessage(parsed.text))
  } catch (error: unknown) {
    return steerFailedResult(error, locale)
  }

  return queuedSteerResult(invocation.agent.status, parsed.text, locale)
}

const NOTICE_PREVIEW_CHARS = 400

/** Quote the queued text for the command card. Long payloads stay queued in full. */
export function quoteForNotice(text: string, locale: UiLocale = 'zh'): string {
  if (text.length <= NOTICE_PREVIEW_CHARS) return text
  return translate(locale, 'steer.preview', {
    preview: text.slice(0, NOTICE_PREVIEW_CHARS),
    count: text.length,
  })
}

function renderThrown(error: unknown, locale: UiLocale): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  try {
    const text = String(error)
    return text.length > 0 ? text : translate(locale, 'steer.unknownError')
  } catch {
    return translate(locale, 'steer.unknownError')
  }
}
