import { describe, expect, it } from 'vitest'
import { CHAT_MIN, EDITOR_MIN, SIDE_MIN, clamp, clampLayout } from '../src/client/workbench/column-layout.ts'

describe('clamp', () => {
  it('keeps the value inside the range', () => {
    expect(clamp(120, 200, 400)).toBe(200)
    expect(clamp(500, 200, 400)).toBe(400)
    expect(clamp(300, 200, 400)).toBe(300)
  })

  it('returns max when the window is too narrow', () => {
    expect(clamp(280, 280, 160)).toBe(160)
  })
})

describe('clampLayout', () => {
  it('keeps preferred widths when the host is wide enough', () => {
    expect(clampLayout(1200, 400, 280, { chat: true, editor: true, side: true })).toEqual({
      chat: 400,
      side: 280,
    })
  })

  it('shrinks the sidebar first, then chat, so the editor keeps its minimum', () => {
    const host = CHAT_MIN + EDITOR_MIN + SIDE_MIN
    const next = clampLayout(host, 480, 400, { chat: true, editor: true, side: true })
    expect(next.side).toBe(SIDE_MIN)
    expect(next.chat).toBe(CHAT_MIN)
    expect(next.chat + EDITOR_MIN + next.side).toBe(host)
  })

  it('keeps shrinking past the soft minimums when the window is very narrow', () => {
    const host = CHAT_MIN + EDITOR_MIN + SIDE_MIN - 40
    const next = clampLayout(host, 480, 400, { chat: true, editor: true, side: true })
    expect(next.chat + EDITOR_MIN + next.side).toBeLessThanOrEqual(host)
    expect(next.side).toBeLessThan(SIDE_MIN)
  })
})
