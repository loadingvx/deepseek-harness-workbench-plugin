import { describe, expect, it } from 'vitest'
import { MAX_STEER_TEXT_LENGTH } from '../src/shared/ultra-slash/catalog.ts'
import { CANVAS_PAYLOAD_EN, CANVAS_PAYLOAD_ZH } from '../src/shared/ultra-slash/canvas-payload.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'

describe('canvas payload', () => {
  it('stays within the steer text limit', () => {
    expect(CANVAS_PAYLOAD_ZH.length).toBeLessThanOrEqual(MAX_STEER_TEXT_LENGTH)
    expect(CANVAS_PAYLOAD_EN.length).toBeLessThanOrEqual(MAX_STEER_TEXT_LENGTH)
    expect(translate('zh', 'canvas.payload').length).toBeLessThanOrEqual(MAX_STEER_TEXT_LENGTH)
  })

  it('requires the workspace .canvas directory and .canvas.tsx naming', () => {
    expect(CANVAS_PAYLOAD_ZH).toContain('.canvas/')
    expect(CANVAS_PAYLOAD_ZH).toContain('.canvas.tsx')
    expect(CANVAS_PAYLOAD_ZH).toContain('工作区根目录')
    expect(CANVAS_PAYLOAD_EN).toContain('.canvas/')
    expect(CANVAS_PAYLOAD_EN).toContain('.canvas.tsx')
  })

  it('forbids empty placeholders and requires writing files to disk', () => {
    expect(CANVAS_PAYLOAD_ZH).toMatch(/禁止空状态|TODO/)
    expect(CANVAS_PAYLOAD_ZH).toContain('写入文件工具')
    expect(CANVAS_PAYLOAD_EN).toMatch(/Never render empty|TODO/)
    expect(CANVAS_PAYLOAD_EN).toContain('write tool')
  })
})
