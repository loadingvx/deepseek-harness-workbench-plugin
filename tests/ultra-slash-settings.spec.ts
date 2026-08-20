// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CONFIGURABLE_DEFAULT_NAMES } from '../src/shared/ultra-slash/catalog.ts'
import { translate, type UltraSlashKey } from '../src/shared/ultra-slash/locales.ts'
import { builtinPayloadDefaults } from '../src/client/ultra-slash/SlashPanel.tsx'

const zhT = (key: string): string => translate('zh', key as UltraSlashKey)
const enT = (key: string): string => translate('en', key as UltraSlashKey)

describe('builtinPayloadDefaults', () => {
  it('prefills skill and docs with the shipped payload, leaves new empty', () => {
    expect(builtinPayloadDefaults(zhT)).toEqual({
      skill: '完成任务后将刚才的方案创建保存为当前项目下的skill备用',
      docs: '完成任务后将问题原因和解决方案输出为md文档写入到docs目录下',
    })
    expect(builtinPayloadDefaults(enT)).toEqual({
      skill: 'After you finish this task, create and save the solution you just used as a skill in the current project for later reuse',
      docs: 'After you finish this task, write the root cause and the solution as a markdown document under the docs directory',
    })
  })

  it('never invents a default for a name that has no payload', () => {
    const defaults = builtinPayloadDefaults(zhT)
    for (const name of CONFIGURABLE_DEFAULT_NAMES) {
      if (name === 'new') continue
      expect(defaults[name]).toBeTruthy()
    }
    expect(defaults.new).toBeUndefined()
  })
})
