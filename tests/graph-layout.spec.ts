import { describe, expect, it } from 'vitest'
import {
  CHANGES_BODY_MIN_H, GRAPH_GUTTER_H, GRAPH_HEADER_H, GRAPH_MIN_H,
  clampGraphHeight, reservedAboveGraph,
} from '../src/client/workbench/graph-layout.ts'

describe('reservedAboveGraph', () => {
  it('keeps room for the changes list and the resize gutter', () => {
    expect(reservedAboveGraph([36, 80, 28])).toBe(36 + 80 + 28 + GRAPH_GUTTER_H + CHANGES_BODY_MIN_H)
  })
})

describe('clampGraphHeight', () => {
  it('keeps a normal saved height', () => {
    expect(clampGraphHeight(220, 800, 200)).toBe(220)
  })

  it('shrinks when the window is too short so GRAPH cannot cover CHANGES', () => {
    expect(clampGraphHeight(400, 360, 200)).toBe(160)
  })

  it('does not grow past the saved height when the window gets taller', () => {
    expect(clampGraphHeight(220, 1200, 200)).toBe(220)
  })

  it('can shrink below the usual minimum when the column is tiny', () => {
    expect(clampGraphHeight(220, 200, 160)).toBe(40)
  })

  it('never goes below the GRAPH header', () => {
    expect(clampGraphHeight(220, 100, 90)).toBe(GRAPH_HEADER_H)
  })

  it('falls back to a usable height on garbage input', () => {
    expect(clampGraphHeight(Number.NaN, 800, 200)).toBe(220)
    expect(clampGraphHeight(220, 800, 200)).toBeGreaterThanOrEqual(Math.min(GRAPH_MIN_H, 600))
  })
})
