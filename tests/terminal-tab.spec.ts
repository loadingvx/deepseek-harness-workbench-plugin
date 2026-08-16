import { describe, expect, it } from 'vitest'
import { createTerminalTab, nextTerminalTab, terminalTabLabel, TERMINAL_TAB_ID } from '../src/client/workbench/types.ts'

const t = (key: string, vars?: Record<string, string | number>): string => {
  if (key === 'term.tab') return 'Terminal'
  if (key === 'term.tabN') return `Terminal ${vars?.n ?? ''}`
  return key
}

describe('terminalTabLabel', () => {
  it('uses the locale key instead of a hardcoded Chinese title', () => {
    const main = createTerminalTab()
    expect(main.id).toBe(TERMINAL_TAB_ID)
    expect(main.title).toBe('')
    expect(terminalTabLabel(main, t)).toBe('Terminal')
  })

  it('numbers extra terminals from the same locale keys', () => {
    const extra = nextTerminalTab([createTerminalTab()])
    expect(extra.termIndex).toBe(2)
    expect(terminalTabLabel(extra, t)).toBe('Terminal 2')
  })
})

describe('nextTerminalTab id isolation', () => {
  it('never reuses a tab id, even for back-to-back creation', () => {
    // Alt+I can create tabs faster than Date.now() advances; a duplicate id
    // would collapse two tabs into one PTY session.
    const tabs = [createTerminalTab()]
    const ids = new Set<string>([tabs[0]!.id])
    for (let i = 0; i < 25; i++) {
      const tab = nextTerminalTab(tabs)
      expect(ids.has(tab.id)).toBe(false)
      expect(tab.id.startsWith('terminal:')).toBe(true)
      expect(tab.id).toMatch(/^terminal:[A-Za-z0-9._-]+$/)
      ids.add(tab.id)
      tabs.push(tab)
    }
    expect(ids.size).toBe(26)
  })
})
