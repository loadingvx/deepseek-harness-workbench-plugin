import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findForbiddenClientRequire,
  findUnexpectedHoistedRequire,
  findUnsafeClientRequire,
} from '../src/shared/client-bundle-guard.ts'

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

describe('findUnexpectedHoistedRequire', () => {
  it('rejects mermaid\'s cytoscape peer when it is hoisted as a factory external', () => {
    const code = [
      'window.__ModuleLoader__.load({ id: "x", factory: (require) => {',
      'let react = require("react");',
      'let cytoscape$1 = require("cytoscape");',
      '//#region src/shared/redact.ts',
      'var Duplex = require("stream").Duplex;',
    ].join('\n')
    expect(findUnexpectedHoistedRequire(code)).toBe('require("cytoscape")')
    expect(findUnsafeClientRequire(code)).toBe('require("cytoscape")')
  })

  it('allows platform seeds in the factory preamble', () => {
    const code = [
      'factory: (require) => {',
      'let react = require("react");',
      'let react_jsx_runtime = require("react/jsx-runtime");',
      'let react_dom = require("react-dom");',
      '//#region src/client/index.ts',
    ].join('\n')
    expect(findUnexpectedHoistedRequire(code)).toBeUndefined()
  })

  it('ignores in-function Node fallbacks after the first source region', () => {
    const code = [
      'factory: (require) => {',
      'let react = require("react");',
      '//#region src/foo.ts',
      'var Duplex = require("stream").Duplex;',
      'let leaked = require("cytoscape");',
    ].join('\n')
    expect(findUnexpectedHoistedRequire(code)).toBeUndefined()
  })
})

describe('lib/client.js', () => {
  const bundle = resolve(import.meta.dirname, '../lib/client.js')

  it('does not hoist require("module") or non-platform packages after a client build', () => {
    if (!existsSync(bundle)) return
    const code = readFileSync(bundle, 'utf8')
    expect(findUnsafeClientRequire(code)).toBeUndefined()
    expect(code).toContain('window.__ModuleLoader__.load')
    expect(code).not.toContain('require("cytoscape")')
  })

  it('does not inline mermaid into the boot factory', () => {
    if (!existsSync(bundle)) return
    const code = readFileSync(bundle, 'utf8')
    expect(code.includes('/git/vendor/mermaid.js')).toBe(true)
    expect(code.includes('@mermaid-js/parser')).toBe(false)
  })
})

describe('lib/vendor/mermaid.js', () => {
  const vendor = resolve(import.meta.dirname, '../lib/vendor/mermaid.js')

  it('is a self-contained ESM bundle, not a re-export of the npm package', () => {
    if (!existsSync(vendor)) return
    const code = readFileSync(vendor, 'utf8')
    expect(code.length).toBeGreaterThan(1_000_000)
    expect(code.startsWith('window.__ModuleLoader__')).toBe(false)
    expect(code.includes(' as default}')).toBe(true)
  })
})
