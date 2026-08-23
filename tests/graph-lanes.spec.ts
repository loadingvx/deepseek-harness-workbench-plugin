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
    expect(rows[1]).toMatchObject({ lane: 1, fromAbove: false, outgoing: [{ from: 1, to: 1 }] })
    expect(rows[2]).toMatchObject({ lane: 0, fromAbove: true, incoming: [1] })
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
    expect(rows[2]?.outgoing).toEqual([{ from: 1, to: 1 }])
    expect(rows[3]).toMatchObject({ lane: 0, incoming: [1] })
  })

  it('keeps HEAD on a straight left lane when another branch is newer', () => {
    const rows = layoutGraphLanes([
      { hash: 'remote', parents: ['base'] },
      { hash: 'head', parents: ['base'] },
      { hash: 'base', parents: [] },
    ], { headHash: 'head' })
    expect(rows.map(row => row.lane)).toEqual([1, 0, 0])
    expect(rows[0]?.outgoing).toEqual([{ from: 1, to: 1 }])
    expect(rows[1]?.outgoing).toEqual([{ from: 0, to: 0 }])
    expect(rows[1]?.passing).toEqual([1])
    expect(rows[2]).toMatchObject({ lane: 0, incoming: [1] })
  })

  it('does not bend the current branch toward a parent already on a side lane', () => {
    const rows = layoutGraphLanes([
      { hash: 'side', parents: ['base'] },
      { hash: 'head', parents: ['base'] },
      { hash: 'base', parents: [] },
    ], { headHash: 'head' })
    expect(rows[1]?.outgoing).toEqual([{ from: 0, to: 0 }])
    expect(rows[1]?.outgoing.some(edge => edge.from !== edge.to)).toBe(false)
  })

  it('widens only the rows that actually use extra lanes so titles indent with the branch', () => {
    const rows = layoutGraphLanes([
      { hash: 'head', parents: ['base'] },
      { hash: 'side', parents: ['base'] },
      { hash: 'base', parents: [] },
    ], { headHash: 'head' })
    expect(rows[0]?.lane).toBe(0)
    expect(rows[0]?.laneCount).toBe(1)
    expect(rows[1]?.lane).toBe(1)
    expect(rows[1]?.laneCount).toBeGreaterThanOrEqual(2)
  })
})
