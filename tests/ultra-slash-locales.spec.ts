import { describe, expect, it } from 'vitest'
import { en, resolveHostLocale, translate, zh, type UltraSlashKey } from '../src/shared/ultra-slash/locales.ts'

describe('locale dictionaries', () => {
  it('keeps the english dictionary complete against the zh key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps menu copy in the matching language', () => {
    expect(zh['steer.description']).toContain('不打断')
    expect(en['steer.description']).toContain('without interrupting')
    expect(en['steer.description']).not.toMatch(/[\u4e00-\u9fff]/)
    expect(zh['menu.group']).toBe('插件命令')
    expect(en['menu.group']).toBe('Ultra Slash')
  })

  it('interpolates placeholders without eating unknown tokens', () => {
    expect(translate('en', 'steer.failed', { detail: 'boom' })).toContain('boom')
    expect(translate('zh', 'steer.preview', { preview: 'ab', count: 9 })).toContain('9')
    expect(translate('en', 'steer.empty', { usage: 'U', example: 'E' })).toContain('U')
  })

  it('reads host locale from settings and falls back to zh', () => {
    expect(resolveHostLocale(undefined)).toBe('zh')
    expect(resolveHostLocale(() => undefined)).toBe('zh')
    expect(resolveHostLocale((name) => {
      if (name !== 'settings') return undefined
      return { get: (ns: string) => ns === 'locale' ? { preference: 'en' } : undefined }
    })).toBe('en')
    expect(resolveHostLocale((name) => {
      if (name !== 'settings') return undefined
      return { get: (ns: string) => ns === 'locale' ? { preference: 'zh' } : undefined }
    })).toBe('zh')
  })

  it('never leaves an english template accidentally in chinese', () => {
    for (const key of Object.keys(zh) as UltraSlashKey[]) {
      if (key.endsWith('.hint')) continue
      expect(zh[key]).toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
