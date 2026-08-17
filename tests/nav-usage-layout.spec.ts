import { describe, expect, it } from 'vitest'
import {
  NAV_SESSION_RESERVE,
  NAV_USAGE_COMPACT_MIN_H,
  NAV_USAGE_DEFAULT_H,
  NAV_USAGE_HEAD_H,
  NAV_USAGE_MIN_H,
  clampNavUsageHeight,
  isNavUsageCompact,
  navHostBleedStyle,
  clampNavContentPad,
  NAV_CONTENT_PAD,
} from '../src/client/workbench/nav-usage-layout.ts'

describe('isNavUsageCompact', () => {
  it('treats a collapsed rail as compact and a normal sidebar as full', () => {
    expect(isNavUsageCompact(48)).toBe(true)
    expect(isNavUsageCompact(72)).toBe(true)
    expect(isNavUsageCompact(256)).toBe(false)
    expect(isNavUsageCompact(0)).toBe(false)
  })
})

describe('clampNavUsageHeight', () => {
  it('keeps a normal saved height', () => {
    expect(clampNavUsageHeight(240, 900, 40)).toBe(240)
  })

  it('shrinks when the window is too short so sessions stay visible', () => {
    expect(clampNavUsageHeight(400, 360, 40)).toBe(360 - 40 - NAV_SESSION_RESERVE)
  })

  it('does not grow past the saved height when the window gets taller', () => {
    expect(clampNavUsageHeight(240, 1400, 40)).toBe(240)
  })

  it('never covers the session reserve even if the user dragged very tall', () => {
    const fitted = clampNavUsageHeight(2000, 800, 48)
    expect(fitted).toBe(800 - 48 - NAV_SESSION_RESERVE)
    expect(fitted + 48 + NAV_SESSION_RESERVE).toBe(800)
  })

  it('can shrink below the usual minimum when the column is tiny', () => {
    expect(clampNavUsageHeight(240, 280, 40)).toBe(280 - 40 - NAV_SESSION_RESERVE)
  })

  it('never goes below the header', () => {
    expect(clampNavUsageHeight(240, 100, 40)).toBe(NAV_USAGE_HEAD_H)
  })

  it('uses a compact minimum that still fits a short rail', () => {
    expect(clampNavUsageHeight(240, 900, 40, true)).toBe(240)
    expect(NAV_USAGE_COMPACT_MIN_H).toBeLessThan(NAV_USAGE_MIN_H)
  })

  it('falls back to a usable height on garbage input', () => {
    expect(clampNavUsageHeight(Number.NaN, 800, 40)).toBe(NAV_USAGE_DEFAULT_H)
  })
})

describe('navHostBleedStyle', () => {
  it('pulls a padded child out to the full sidebar width', () => {
    expect(navHostBleedStyle(280, 0, 12)).toEqual({
      marginLeft: '-12px',
      width: '280px',
      maxWidth: '280px',
    })
  })

  it('stays flush when already full width', () => {
    expect(navHostBleedStyle(280, 8, 8)).toEqual({
      marginLeft: '0px',
      width: '280px',
      maxWidth: '280px',
    })
  })

  it('ignores an unmeasured sidebar', () => {
    expect(navHostBleedStyle(0, 0, 12)).toBeNull()
  })
})

describe('clampNavContentPad', () => {
  it('keeps a normal workspace indent', () => {
    expect(clampNavContentPad(12)).toBe(12)
    expect(clampNavContentPad(16)).toBe(16)
  })

  it('falls back when the measurement is empty', () => {
    expect(clampNavContentPad(0)).toBe(NAV_CONTENT_PAD)
    expect(clampNavContentPad(Number.NaN)).toBe(NAV_CONTENT_PAD)
  })
})
