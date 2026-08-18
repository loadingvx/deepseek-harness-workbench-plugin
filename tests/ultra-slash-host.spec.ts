import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('workbench ultra-slash host wiring', () => {
  it('loads after the commands service so /steer can register', () => {
    expect(plugin.name).toBe('dsh-workbench-plugin')
    expect(plugin.inject).toContain('commands')
    expect(plugin.inject).toContain('webServer')
  })

  it('wires the browser slash menu to inputTriggers', () => {
    const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(client).toContain("'inputTriggers'")
    expect(client).toContain('installUltraSlashClient')
  })
})
