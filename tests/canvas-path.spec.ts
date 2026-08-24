import { describe, expect, it } from 'vitest'
import { isCanvasPath } from '../src/shared/canvas-path.ts'

describe('isCanvasPath', () => {
  it('matches workspace .canvas deliverables', () => {
    expect(isCanvasPath('.canvas/demo.canvas.tsx')).toBe(true)
    expect(isCanvasPath('pkg/.canvas/order-dashboard.canvas.tsx')).toBe(true)
  })

  it('rejects arbitrary tsx files', () => {
    expect(isCanvasPath('src/App.tsx')).toBe(false)
    expect(isCanvasPath('foo.canvas.ts')).toBe(false)
    expect(isCanvasPath('.canvas/readme.md')).toBe(false)
  })
})
