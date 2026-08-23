import { describe, expect, it } from 'vitest'
import {
  buildTermReference,
  clipboardTermRef,
  encodeTermRef,
  normalizeTermRefSnapshot,
  parseTermRef,
  serializeTermRef,
  serializeTermRefRef,
  TERM_REF_SOURCE,
  termRefChipLabel,
  termRefLabelOf,
} from '../src/shared/term-ref.ts'

describe('term ref codec', () => {
  it('normalizes and clamps terminal text', () => {
    expect(normalizeTermRefSnapshot({ text: '  hello \n world  ' })).toEqual({ text: 'hello \n world' })
    expect(normalizeTermRefSnapshot({ text: '   ' })).toBeNull()
    const big = normalizeTermRefSnapshot({ text: 'x'.repeat(30_000) })
    expect(big?.text.length).toBe(20_000)
  })

  it('round-trips encode/parse/serialize for the model form', () => {
    const snapshot = { text: 'npm test\n  ✓ 70 files' }
    const ref = encodeTermRef(snapshot)
    expect(parseTermRef(ref)).toEqual(snapshot)
    expect(serializeTermRef(snapshot)).toBe('npm test\n  ✓ 70 files')
    expect(serializeTermRefRef(ref)).toBe('npm test\n  ✓ 70 files')
    expect(clipboardTermRef(ref)).toBe('npm test\n  ✓ 70 files')
    expect(serializeTermRefRef('garbage')).toContain('已过期')
  })

  it('prepends the shell context when present', () => {
    const built = buildTermReference({ text: 'ls: cannot access x', context: 'pwd: /root/app · shell: bash' })
    expect(built?.label).toBe('ls: cannot access x')
    expect(serializeTermRefRef(built!.ref)).toBe('【终端内容】pwd: /root/app · shell: bash\n---\nls: cannot access x')
  })

  it('builds a reference with a compact first-line label', () => {
    const built = buildTermReference({ text: 'npm test\n  ✓ 70 files' })
    expect(built?.source).toBe(TERM_REF_SOURCE)
    expect(built?.label).toBe('npm test')
    const again = buildTermReference(
      { text: 'npm test\n  ✓ 70 files' },
      [{ ref: built!.ref, label: 'npm test' }],
    )
    expect(again?.label).toBe('npm test · 2')
    expect(termRefLabelOf('hello   world')).toBe('hello world')
    expect(termRefLabelOf('x'.repeat(100)).endsWith('…')).toBe(true)
    expect(termRefChipLabel('a\nb', [])).toBe('a')
  })
})
