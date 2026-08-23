import { describe, expect, it } from 'vitest'
import { surfaceColorScheme } from '../src/client/workbench/surface-scheme.ts'

describe('surfaceColorScheme', () => {
  it('treats a dark background as dark so native menus match', () => {
    expect(surfaceColorScheme('#1a1a1a')).toBe('dark')
    expect(surfaceColorScheme('rgb(20, 20, 24)')).toBe('dark')
  })

  it('treats a light background as light', () => {
    expect(surfaceColorScheme('#ffffff')).toBe('light')
    expect(surfaceColorScheme('#f5f5f5')).toBe('light')
    expect(surfaceColorScheme('#fff')).toBe('light')
  })

  it('falls back when the color cannot be parsed', () => {
    expect(surfaceColorScheme('', 'dark')).toBe('dark')
    expect(surfaceColorScheme('var(--unknown)')).toBe('light')
  })
})
