import { describe, expect, it } from 'vitest'
import { IDE_HOST_CSS } from '../src/client/workbench/ide-host.css.ts'

describe('IDE host split', () => {
  it('lets the editor and file/git sidebar span the full conversation column height', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=editor]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=side]')
    expect(IDE_HOST_CSS).toContain('grid-row: 1 / 3')
    expect(IDE_HOST_CSS).toContain('grid-column: 1;')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=status]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-phase=hero]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=update]')
    expect(IDE_HOST_CSS).toContain('[data-decoration="chip"][data-dsh-long]>span')
    expect(IDE_HOST_CSS).toContain('justify-content:flex-end')
  })

  it('stacks the terminal and status bar in one bottom strip so no empty row sits between them', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=bottom]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=terminal]')
    expect(IDE_HOST_CSS).toContain('flex-direction: column')
    expect(IDE_HOST_CSS).toContain('gap: 0')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=editor]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=right]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=full]')
    expect(IDE_HOST_CSS).toContain('--git-term-h')
    expect(IDE_HOST_CSS).not.toContain('grid-template-rows: auto minmax(0, 1fr) var(--git-term-h')
  })

  it('keeps column sashes on the grid so they work over the bottom terminal and editor rail', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=sash-chat]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=sash-side]')
    expect(IDE_HOST_CSS).toContain('grid-row: 1 / -1')
  })
})
