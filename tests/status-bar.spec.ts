import { describe, expect, it } from 'vitest'
import { fileName, shortPath, STATUS_BAR_H, showEditorStatusChrome, statusMenuAnchorStyle, tabStripOverflow, tabStripScrollDelta } from '../src/client/workbench/status-bar.ts'

describe('STATUS_BAR_H', () => {
  it('matches the conversation stats line under the composer', () => {
    expect(STATUS_BAR_H).toBe(24)
  })
})

describe('shortPath', () => {
  it('keeps a short folder and shortens a deep one', () => {
    expect(shortPath('/tmp/app')).toBe('/tmp/app')
    expect(shortPath('/home/user/work/acme/app')).toBe('…/acme/app')
  })

  it('redacts tokens in the path before showing it', () => {
    expect(shortPath('/home/user/ghp_abcdefghijklmnopqrstuv/app')).toBe('…/ghp_abc***uv/app')
  })
})

describe('fileName', () => {
  it('takes the last segment', () => {
    expect(fileName('src/client/api.ts')).toBe('api.ts')
  })
})

describe('tabStripOverflow', () => {
  it('hides both triangles when everything fits', () => {
    expect(tabStripOverflow(0, 200, 180)).toEqual({ canLeft: false, canRight: false })
  })

  it('shows the right triangle when more tabs sit past the edge', () => {
    expect(tabStripOverflow(0, 200, 360)).toEqual({ canLeft: false, canRight: true })
  })

  it('shows both after scrolling into the middle', () => {
    expect(tabStripOverflow(80, 200, 360)).toEqual({ canLeft: true, canRight: true })
  })

  it('shows only the left triangle at the end', () => {
    expect(tabStripOverflow(160, 200, 360)).toEqual({ canLeft: true, canRight: false })
  })
})

describe('tabStripScrollDelta', () => {
  it('jumps at least one short tab', () => {
    expect(tabStripScrollDelta(40)).toBe(80)
    expect(tabStripScrollDelta(200)).toBe(120)
  })
})

describe('statusMenuAnchorStyle', () => {
  const viewport = { width: 1200, height: 800 }

  it('pins the menu right edge to the anchor and pops it above the bar', () => {
    // Anchor (the Layout button) sits at the bottom right, 24px status bar high.
    const style = statusMenuAnchorStyle({ right: 1150, top: 776 }, viewport)
    expect(style.right).toBe(50)
    expect(style.bottom).toBe(28)
  })

  it('keeps the menu on screen when the anchor hugs the viewport edges', () => {
    expect(statusMenuAnchorStyle({ right: 1200, top: 800 }, viewport)).toEqual({ right: 8, bottom: 8 })
    expect(statusMenuAnchorStyle({ right: 0, top: 0 }, viewport)).toEqual({ right: 1200, bottom: 804 })
  })
})

describe('showEditorStatusChrome', () => {
  it('hides tabs, the tab list and overflow triangles when the editor is collapsed', () => {
    expect(showEditorStatusChrome(true)).toBe(true)
    expect(showEditorStatusChrome(false)).toBe(false)
  })
})
