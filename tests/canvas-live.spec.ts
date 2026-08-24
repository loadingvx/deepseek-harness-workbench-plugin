import { describe, expect, it, vi } from 'vitest'
import { __testApplyCanvasOpenSnapshot } from '../src/client/workbench/canvas-live.ts'

describe('canvas live', () => {
  it('opens only paths newer than the last seq', () => {
    const open = vi.fn()
    __testApplyCanvasOpenSnapshot({
      revision: 2,
      opens: [
        { path: '.canvas/a.canvas.tsx', seq: 1 },
        { path: '.canvas/b.canvas.tsx', seq: 2 },
      ],
    }, open)
    expect(open).toHaveBeenCalledTimes(2)
    expect(open.mock.calls.map((row) => row[0])).toEqual([
      '.canvas/a.canvas.tsx',
      '.canvas/b.canvas.tsx',
    ])
  })
})
