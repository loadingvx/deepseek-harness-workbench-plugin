import { describe, expect, it } from 'vitest'
import {
  AUTO_FETCH_DEFAULT_MINUTES,
  AUTO_FETCH_MAX_MINUTES,
  AUTO_FETCH_MIN_MINUTES,
  AUTO_FETCH_OFF_MINUTES,
  autoFetchMinutesToMs,
  nextAutoFetchDelayMs,
  parseAutoFetchMinutes,
  parseAutoFetchMinutesInput,
} from '../src/shared/git-auto-fetch.ts'

describe('git-auto-fetch', () => {
  it('defaults to 60 minutes and accepts 0 as off', () => {
    expect(parseAutoFetchMinutes(undefined)).toBe(AUTO_FETCH_DEFAULT_MINUTES)
    expect(parseAutoFetchMinutes(-1)).toBe(AUTO_FETCH_DEFAULT_MINUTES)
    expect(parseAutoFetchMinutes(AUTO_FETCH_OFF_MINUTES)).toBe(0)
    expect(parseAutoFetchMinutes(90)).toBe(90)
    expect(autoFetchMinutesToMs(60)).toBe(3_600_000)
    expect(autoFetchMinutesToMs(0)).toBe(0)
  })

  it('parses settings input like GRAPH limit', () => {
    expect(parseAutoFetchMinutesInput('')).toEqual({ ok: false, error: 'empty' })
    expect(parseAutoFetchMinutesInput('1.5')).toEqual({ ok: false, error: 'invalid' })
    expect(parseAutoFetchMinutesInput('0')).toEqual({ ok: true, value: 0 })
    expect(parseAutoFetchMinutesInput('3')).toEqual({ ok: false, error: 'low' })
    expect(parseAutoFetchMinutesInput(String(AUTO_FETCH_MIN_MINUTES))).toEqual({
      ok: true, value: AUTO_FETCH_MIN_MINUTES,
    })
    expect(parseAutoFetchMinutesInput(String(AUTO_FETCH_MAX_MINUTES + 1))).toEqual({
      ok: false, error: 'high',
    })
  })

  it('backs off to at least 2× last duration on failure', () => {
    const hour = 3_600_000
    expect(nextAutoFetchDelayMs(0, true, 90_000)).toBe(0)
    expect(nextAutoFetchDelayMs(hour, false, 90_000)).toBe(hour)
    expect(nextAutoFetchDelayMs(hour, true, 90_000)).toBe(hour)
    expect(nextAutoFetchDelayMs(15 * 60_000, true, 10 * 60_000)).toBe(20 * 60_000)
  })
})
