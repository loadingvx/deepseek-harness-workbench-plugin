import { describe, expect, it } from 'vitest'
import { IDE_HOST_CSS } from '../src/client/workbench/ide-host.css.ts'

describe('IDE host split', () => {
  it('fills the host with chat and an optional side dock (no workbench editor)', () => {
    expect(IDE_HOST_CSS).toContain('grid-template-rows: minmax(0, 1fr) auto')
    expect(IDE_HOST_CSS).toContain('[data-git-ide] > [data-conversation-scroll]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=side]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=status]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-phase=hero]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=editor]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=update]')
    expect(IDE_HOST_CSS).toContain('[data-decoration="chip"][data-dsh-long]>span')
    expect(IDE_HOST_CSS).toContain('justify-content:flex-end')
  })

  it('keeps StatusBar in the bottom strip with chat / side / full spans', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=bottom]')
    expect(IDE_HOST_CSS).toContain('flex-direction: column')
    expect(IDE_HOST_CSS).toContain('gap: 0')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=chat]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=side]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide][data-git-bottom-span=full]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=terminal]')
    expect(IDE_HOST_CSS).not.toContain('--git-term-h')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide][data-git-bottom-span=editor]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide][data-git-bottom-span=right]')
  })

  it('keeps the side sash on the full grid height', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=sash-side]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=rail-chat]')
    expect(IDE_HOST_CSS).toContain('grid-row: 1 / -1')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=sash-chat]')
  })
})
