import { describe, expect, it } from 'vitest'
import { formatToolDisplay } from '../src/shared/trajectory-tool-display.ts'

describe('trajectory tool display', () => {
  it('shows shell command instead of run_code name', () => {
    const display = formatToolDisplay('run_code', JSON.stringify({
      command: 'grep -r trajectory src/',
      description: 'search',
    }))
    expect(display.title).toBe('grep -r trajectory src/')
    expect(display.tag).toBe('')
    expect(display.inputText).toContain('grep -r trajectory')
  })

  it('shows file path for Read', () => {
    const display = formatToolDisplay('Read', JSON.stringify({ path: 'src/foo.ts' }))
    expect(display.title).toBe('src/foo.ts')
    expect(display.tag).toBe('读取')
  })
})
