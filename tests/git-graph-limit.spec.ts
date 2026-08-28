import { describe, expect, it } from 'vitest'
import {
  GRAPH_LIMIT_DEFAULT, GRAPH_LIMIT_MAX, GRAPH_LIMIT_MIN,
  clampGitLogLimit, parseGraphLimitInput, parseHttpLogLimit,
} from '../src/shared/git-graph-limit.ts'

describe('parseGraphLimitInput', () => {
  it('accepts integers in range', () => {
    expect(parseGraphLimitInput('256')).toEqual({ ok: true, value: 256 })
    expect(parseGraphLimitInput(' 80 ')).toEqual({ ok: true, value: 80 })
    expect(parseGraphLimitInput(String(GRAPH_LIMIT_MIN))).toEqual({ ok: true, value: GRAPH_LIMIT_MIN })
    expect(parseGraphLimitInput(String(GRAPH_LIMIT_MAX))).toEqual({ ok: true, value: GRAPH_LIMIT_MAX })
  })

  it('rejects empty, junk, and out-of-range so the dialog can show a precise error', () => {
    expect(parseGraphLimitInput('')).toEqual({ ok: false, error: 'empty' })
    expect(parseGraphLimitInput('  ')).toEqual({ ok: false, error: 'empty' })
    expect(parseGraphLimitInput('2.5')).toEqual({ ok: false, error: 'invalid' })
    expect(parseGraphLimitInput('-1')).toEqual({ ok: false, error: 'invalid' })
    expect(parseGraphLimitInput('abc')).toEqual({ ok: false, error: 'invalid' })
    expect(parseGraphLimitInput('0')).toEqual({ ok: false, error: 'low' })
    expect(parseGraphLimitInput('19')).toEqual({ ok: false, error: 'low' })
    expect(parseGraphLimitInput('2001')).toEqual({ ok: false, error: 'high' })
  })
})

describe('clampGitLogLimit', () => {
  it('defaults garbage and clamps to 1…MAX for host/tools', () => {
    expect(clampGitLogLimit(GRAPH_LIMIT_DEFAULT)).toBe(256)
    expect(clampGitLogLimit(5)).toBe(5)
    expect(clampGitLogLimit(0)).toBe(1)
    expect(clampGitLogLimit(99999)).toBe(GRAPH_LIMIT_MAX)
    expect(clampGitLogLimit(Number.NaN)).toBe(GRAPH_LIMIT_DEFAULT)
  })
})

describe('parseHttpLogLimit', () => {
  it('defaults a missing query to 256 and rejects junk', () => {
    expect(parseHttpLogLimit(undefined)).toBe(256)
    expect(parseHttpLogLimit('')).toBe(256)
    expect(parseHttpLogLimit('256')).toBe(256)
    expect(parseHttpLogLimit('1')).toBe(1)
    expect(parseHttpLogLimit('foo')).toBeNull()
    expect(parseHttpLogLimit('0')).toBeNull()
    expect(parseHttpLogLimit('2001')).toBeNull()
  })
})
