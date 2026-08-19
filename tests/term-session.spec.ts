import { describe, expect, it } from 'vitest'
import { isCleanTermExit } from '../src/client/workbench/term-session.ts'

describe('isCleanTermExit', () => {
  it('treats Ctrl+D / exit 0 as a normal logout', () => {
    expect(isCleanTermExit(0)).toBe(true)
  })

  it('keeps crashes and host kills as failures', () => {
    expect(isCleanTermExit(1)).toBe(false)
    expect(isCleanTermExit(127)).toBe(false)
    expect(isCleanTermExit(null)).toBe(false)
  })
})
