import { describe, expect, it } from 'vitest'
import { MAX_STEER_TEXT_LENGTH } from '../src/shared/ultra-slash/catalog.ts'
import { SKILL_PAYLOAD_EN, SKILL_PAYLOAD_ZH } from '../src/shared/ultra-slash/skill-payload.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'

describe('skill payload', () => {
  it('stays within the steer text limit', () => {
    expect(SKILL_PAYLOAD_ZH.length).toBeLessThanOrEqual(MAX_STEER_TEXT_LENGTH)
    expect(SKILL_PAYLOAD_EN.length).toBeLessThanOrEqual(MAX_STEER_TEXT_LENGTH)
    expect(translate('zh', 'skill.payload')).toBe(SKILL_PAYLOAD_ZH)
    expect(translate('en', 'skill.payload')).toBe(SKILL_PAYLOAD_EN)
  })

  it('requires the official DSH project skill path and SKILL.md layout', () => {
    for (const payload of [SKILL_PAYLOAD_ZH, SKILL_PAYLOAD_EN]) {
      expect(payload).toContain('.dsh/skills/')
      expect(payload).toContain('SKILL.md')
      expect(payload).toContain('<projectRoot>/.dsh/skills/')
      expect(payload).toContain('name:')
      expect(payload).toContain('description:')
    }
  })

  it('forbids paths that Harness will not load', () => {
    for (const payload of [SKILL_PAYLOAD_ZH, SKILL_PAYLOAD_EN]) {
      expect(payload).toContain('.cursor/skills/')
      expect(payload).toContain('.agents/skills/')
      expect(payload).toContain('~/.dsh/skills/')
    }
  })

  it('requires writing files to disk and keeping the skill model-invocable', () => {
    expect(SKILL_PAYLOAD_ZH).toContain('写入文件工具')
    expect(SKILL_PAYLOAD_ZH).toContain('disable-model-invocation')
    expect(SKILL_PAYLOAD_EN).toContain('write tool')
    expect(SKILL_PAYLOAD_EN).toContain('disable-model-invocation')
  })
})
