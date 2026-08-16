/**
 * DSH web ModuleLoader only knows platform seeds, shell-own modules, and
 * registered factories. A leftover `require("module")` / `require("node:…")`
 * is hoisted to the factory top and crashes plugin load.
 */
export const FORBIDDEN_CLIENT_REQUIRE = /require\(["'](?:node:[^"']+|module)["']\)/

export function findForbiddenClientRequire(code: string): string | undefined {
  return FORBIDDEN_CLIENT_REQUIRE.exec(code)?.[0]
}
