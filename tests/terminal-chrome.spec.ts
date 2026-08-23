import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))

describe('terminal chrome follows host theme', () => {
  it('does not hardcode VS Code dark colors on the tab bar or cwd strip', () => {
    const panel = readFileSync(join(dir, '../src/client/workbench/TerminalPanel.module.css'), 'utf8')
    const view = readFileSync(join(dir, '../src/client/workbench/TerminalView.module.css'), 'utf8')
    expect(panel).not.toContain('#1e1e1e')
    expect(panel).toContain('--dsw-alias-interactive-bg-hover')
    expect(view).not.toContain('#252526')
    expect(view).not.toContain('#9d9d9d')
    expect(view).not.toContain('#c8c8c8')
    expect(view).not.toContain('.meta')
    expect(view).toContain('.chrome')
    expect(view).toMatch(/\.term[\s\S]*#1e1e1e/)
  })
})
