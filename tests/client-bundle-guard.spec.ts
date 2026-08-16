import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findForbiddenClientRequire } from '../src/shared/client-bundle-guard.ts'

describe('findForbiddenClientRequire', () => {
  it('rejects a hoisted require("module") that crashes DSH ModuleLoader', () => {
    expect(findForbiddenClientRequire('let module$1 = require("module");')).toBe('require("module")')
    expect(findForbiddenClientRequire("var m = require('module');")).toBe("require('module')")
  })

  it('rejects require("node:…") leftovers', () => {
    expect(findForbiddenClientRequire('const fs = require("node:fs");')).toBe('require("node:fs")')
    expect(findForbiddenClientRequire("require('node:path')")).toBe("require('node:path')")
  })

  it('allows DSH platform seeds and in-function Node fallbacks that are not hoisted builtins', () => {
    expect(findForbiddenClientRequire('let react = require("react");')).toBeUndefined()
    expect(findForbiddenClientRequire('let jsx = require("react/jsx-runtime");')).toBeUndefined()
    expect(findForbiddenClientRequire('var Duplex = require("stream").Duplex;')).toBeUndefined()
  })
})

describe('lib/client.js', () => {
  const bundle = resolve(import.meta.dirname, '../lib/client.js')

  it('does not hoist require("module") after a client build', () => {
    if (!existsSync(bundle)) return
    const code = readFileSync(bundle, 'utf8')
    expect(findForbiddenClientRequire(code)).toBeUndefined()
    expect(code).toContain('window.__ModuleLoader__.load')
  })
})
