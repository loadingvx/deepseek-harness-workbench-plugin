// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  siblingTabIds,
  tabCloseTargets,
  tabHasCloseControl,
} from '../src/client/workbench/sidebar-right/tab-close-targets.ts'

describe('tabCloseTargets', () => {
  it('reads closable siblings left and right of the active chip', () => {
    document.body.innerHTML = `
      <div data-dockkit-pane="pane-1">
        <div data-dockkit-tab="a"><button data-dockkit-tab-close="a"></button></div>
        <div data-dockkit-tab="b"><button data-dockkit-tab-close="b"></button></div>
        <div data-dockkit-tab="c"><button data-dockkit-tab-close="c"></button></div>
        <div data-dockkit-tab="guide"></div>
      </div>
    `
    expect(siblingTabIds('b')).toEqual(['a', 'b', 'c', 'guide'])
    expect(tabHasCloseControl('guide')).toBe(false)
    expect(tabCloseTargets('b')).toEqual({
      others: ['a', 'c'],
      all: ['a', 'b', 'c'],
      left: ['a'],
      right: ['c'],
    })
  })

  it('returns empty groups when the chip is missing', () => {
    document.body.innerHTML = ''
    expect(tabCloseTargets('missing')).toEqual({
      others: [],
      all: [],
      left: [],
      right: [],
    })
  })
})
