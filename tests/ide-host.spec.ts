import { describe, expect, it } from 'vitest'
import { IDE_HOST_CSS } from '../src/client/workbench/ide-host.css.ts'

describe('IDE host split', () => {
  it('lets the editor and file/git sidebar span the full conversation column height', () => {
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=editor]')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=side]')
    expect(IDE_HOST_CSS).toContain('grid-row: 1 / 3')
    expect(IDE_HOST_CSS).toContain('grid-column: 1;')
    expect(IDE_HOST_CSS).toContain('[data-git-ide-panel=status]')
    expect(IDE_HOST_CSS).not.toContain('[data-git-ide-panel=update]')
  })
})
