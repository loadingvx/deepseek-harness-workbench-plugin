// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SVG_RENDER_ON,
  getSvgRenderOn,
  resetSvgRenderOn,
  setSvgRenderOn,
  SVG_RENDER_ON_KEY,
  subscribeSvgRenderOn,
} from '../src/client/workbench/svg-render-settings.ts'

afterEach(() => {
  resetSvgRenderOn()
  try {
    localStorage.removeItem(SVG_RENDER_ON_KEY)
  } catch { /* ignore */ }
})

describe('svg render switch defaults', () => {
  it('defaults to on (能力移植自 svg-viewer，默认渲染)', () => {
    expect(DEFAULT_SVG_RENDER_ON).toBe(true)
    expect(getSvgRenderOn()).toBe(true)
  })
})

describe('svg render switch persistence', () => {
  it('persists the switch to localStorage and restores it', () => {
    setSvgRenderOn(false)
    expect(localStorage.getItem(SVG_RENDER_ON_KEY)).toBe('0')
    expect(getSvgRenderOn()).toBe(false)
    setSvgRenderOn(true)
    expect(localStorage.getItem(SVG_RENDER_ON_KEY)).toBe('1')
    expect(getSvgRenderOn()).toBe(true)
  })
})

describe('subscribers', () => {
  it('notify only on actual change', () => {
    const seen: boolean[] = []
    const off = subscribeSvgRenderOn((on) => { seen.push(on) })
    setSvgRenderOn(false)
    setSvgRenderOn(false) // 无变化不通知
    setSvgRenderOn(true)
    expect(seen).toEqual([false, true])
    off()
  })

  it('stops notifying after unsubscribe', () => {
    const seen: boolean[] = []
    const off = subscribeSvgRenderOn((on) => { seen.push(on) })
    off()
    setSvgRenderOn(false)
    expect(seen).toEqual([])
  })
})
