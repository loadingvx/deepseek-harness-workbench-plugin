import { describe, expect, it } from 'vitest'
import { CanvasOpenQueue } from '../src/host/canvas-open-queue.ts'

describe('CanvasOpenQueue', () => {
  it('queues canvas paths with monotonic seq', () => {
    const queue = new CanvasOpenQueue()
    queue.noteOpen('/ws', '.canvas/a.canvas.tsx')
    queue.noteOpen('/ws', 'src/foo.ts')
    queue.noteOpen('/ws', '.canvas/b.canvas.tsx')
    expect(queue.snapshot('/ws', 0)).toEqual({
      revision: 2,
      opens: [
        { path: '.canvas/a.canvas.tsx', seq: 1 },
        { path: '.canvas/b.canvas.tsx', seq: 2 },
      ],
    })
    expect(queue.snapshot('/ws', 1)).toEqual({
      revision: 2,
      opens: [{ path: '.canvas/b.canvas.tsx', seq: 2 }],
    })
  })
})
