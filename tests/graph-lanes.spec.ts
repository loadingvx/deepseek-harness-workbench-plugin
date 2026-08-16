import { describe, expect, it } from 'vitest'
import { graphNodesFromEntries, layoutGraphLanes } from '../src/client/workbench/graph-lanes.ts'

describe('graphNodesFromEntries', () => {
  it('keeps host parent hashes', () => {
    expect(graphNodesFromEntries([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: [] },
    ])).toEqual([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: [] },
    ])
  })

  it('falls back to a straight line when the host omitted parents', () => {
    expect(graphNodesFromEntries([
      { hash: 'a' },
      { hash: 'b' },
      { hash: 'c' },
    ])).toEqual([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c'] },
      { hash: 'c', parents: [] },
    ])
  })
})

describe('layoutGraphLanes', () => {
  it('keeps a linear history on lane 0', () => {
    const rows = layoutGraphLanes([
      { hash: 'c3', parents: ['c2'] },
      { hash: 'c2', parents: ['c1'] },
      { hash: 'c1', parents: [] },
    ])
    expect(rows.map(row => row.lane)).toEqual([0, 0, 0])
    expect(rows.map(row => row.fromAbove)).toEqual([false, true, true])
    expect(rows.every(row => row.laneCount === 1)).toBe(true)
    expect(rows[0]?.outgoing).toEqual([{ from: 0, to: 0 }])
  })

  it('opens a second lane when two tips share a parent', () => {
    const rows = layoutGraphLanes([
      { hash: 'local', parents: ['base'] },
      { hash: 'remote', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    expect(rows[0]).toMatchObject({ lane: 0, fromAbove: false, outgoing: [{ from: 0, to: 0 }] })
    expect(rows[1]).toMatchObject({ lane: 1, fromAbove: false, outgoing: [{ from: 1, to: 0 }] })
    expect(rows[2]).toMatchObject({ lane: 0, fromAbove: true })
    expect(rows[1]?.laneCount).toBeGreaterThanOrEqual(2)
  })

  it('draws a merge commit with two outgoing parents', () => {
    const rows = layoutGraphLanes([
      { hash: 'merge', parents: ['left', 'right'] },
      { hash: 'left', parents: ['base'] },
      { hash: 'right', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    expect(rows[0]?.lane).toBe(0)
    expect(rows[0]?.outgoing).toEqual([
      { from: 0, to: 0 },
      { from: 0, to: 1 },
    ])
    expect(rows[1]?.lane).toBe(0)
    expect(rows[2]?.lane).toBe(1)
    expect(rows[2]?.outgoing).toEqual([{ from: 1, to: 0 }])
    expect(rows[3]?.lane).toBe(0)
  })
})
