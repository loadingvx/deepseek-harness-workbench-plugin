import { describe, expect, it } from 'vitest'
import {
  cancelledSteerResult,
  emptySteerResult,
  parseSteerInput,
  queuedSteerResult,
  quoteForNotice,
  steerFailedResult,
} from '../src/host/ultra-slash/command.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'

describe('parseSteerInput', () => {
  it('rejects empty and whitespace-only suffixes', () => {
    expect(parseSteerInput('')).toEqual({ kind: 'empty' })
    expect(parseSteerInput('   \n\t  ')).toEqual({ kind: 'empty' })
  })

  it('keeps inner text after trimming the suffix', () => {
    expect(parseSteerInput('  先不要改代码  ')).toEqual({
      kind: 'steer',
      text: '先不要改代码',
    })
  })

  it('keeps newlines and punctuation inside the payload', () => {
    expect(parseSteerInput('\n第一步：列文件\n第二步：再改\n')).toEqual({
      kind: 'steer',
      text: '第一步：列文件\n第二步：再改',
    })
  })
})

describe('command notices', () => {
  it('empty result tells the user exactly what to type', () => {
    const result = emptySteerResult()
    expect(result.kind).toBe('error')
    expect(result.text).toContain(translate('zh', 'steer.usage'))
    expect(result.text).toContain(translate('zh', 'steer.example'))
    expect(result.text).toContain('不会停止当前对话')
  })

  it('running vs idle notices do not claim the turn was stopped', () => {
    const running = queuedSteerResult('running', '只看测试')
    const idle = queuedSteerResult('idle', '只看测试')
    expect(running.text).toContain('不会被打断')
    expect(running.text).toContain('只看测试')
    expect(idle.text).toContain('即将开始下一步')
    expect(idle.text).toContain('只看测试')
    expect(running.text).not.toContain('已停止')
    expect(idle.text).not.toContain('已停止')
  })

  it('cancelled and failed notices say nothing was injected', () => {
    expect(cancelledSteerResult().text).toContain('没有注入')
    expect(steerFailedResult(new Error('inbox closed')).text).toContain('inbox closed')
    expect(steerFailedResult(new Error('inbox closed')).text).toContain('没有被打断')
    expect(steerFailedResult(Symbol('x')).kind).toBe('error')
  })

  it('long payloads stay queued in full; the notice only previews', () => {
    const text = '字'.repeat(500)
    const quoted = quoteForNotice(text)
    expect(quoted).toContain('已完整排队，共 500 字')
    expect(quoted.startsWith('字'.repeat(400))).toBe(true)
    expect(quoteForNotice('短')).toBe('短')
  })

  it('english notices do not keep chinese templates', () => {
    const empty = emptySteerResult('en')
    expect(empty.text).toContain('Usage: /steer')
    expect(empty.text).not.toMatch(/[\u4e00-\u9fff]/)
    const running = queuedSteerResult('running', 'look at tests', 'en')
    expect(running.text).toContain('not interrupted')
    expect(running.text).toContain('look at tests')
    expect(cancelledSteerResult('en').text).toContain('Nothing was injected')
    expect(steerFailedResult(new Error('inbox closed'), 'en').text).toContain('was not interrupted')
    expect(quoteForNotice('x'.repeat(500), 'en')).toContain('characters')
  })
})
