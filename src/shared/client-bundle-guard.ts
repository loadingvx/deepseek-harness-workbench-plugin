/**
 * DSH web ModuleLoader only knows platform seeds, shell-own modules, and
 * registered factories. A leftover `require("module")` / `require("node:…")`
 * or a drifted `require("cytoscape")` is hoisted to the factory top and
 * crashes plugin load.
 */

/** Package ids the host ModuleLoader can satisfy when the client factory runs. */
export const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/index',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

export type ClientExternal = (typeof CLIENT_EXTERNALS)[number]

const CLIENT_EXTERNAL_SET = new Set<string>(CLIENT_EXTERNALS)

export const FORBIDDEN_CLIENT_REQUIRE = /require\(["'](?:node:[^"']+|module)["']\)/

const ANY_REQUIRE = /require\(["']([^"']+)["']\)/g

export function findForbiddenClientRequire(code: string): string | undefined {
  return FORBIDDEN_CLIENT_REQUIRE.exec(code)?.[0]
}

/**
 * Rolldown hoists unresolved externals to the factory preamble, before the
 * first real `//#region`. Those `require("pkg")` calls run at plugin load.
 * Nested Node fallbacks later in the file (e.g. `require("stream").Duplex`)
 * are not hoisted and are left for runtime dead-code.
 */
export function findUnexpectedHoistedRequire(code: string): string | undefined {
  const preamble = factoryPreamble(code)
  ANY_REQUIRE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ANY_REQUIRE.exec(preamble)) !== null) {
    const id = match[1]
    if (id !== undefined && !CLIENT_EXTERNAL_SET.has(id)) return match[0]
  }
  return undefined
}

export function findUnsafeClientRequire(code: string): string | undefined {
  return findForbiddenClientRequire(code) ?? findUnexpectedHoistedRequire(code)
}

function factoryPreamble(code: string): string {
  const lines: string[] = []
  for (const line of code.split('\n')) {
    if (line.includes('//#region') && !line.includes('rolldown/runtime')) break
    lines.push(line)
  }
  return lines.join('\n')
}
