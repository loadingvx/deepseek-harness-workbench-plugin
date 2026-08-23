// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  extractSvgs,
  isStandardSvg,
  sanitizeSvg,
  selectSvgTail,
  SVG_RENDER_EXAMPLE,
} from '../src/client/workbench/svg-tail.ts'
import {
  resetSvgRenderOn,
  selectSvgTailGated,
  setSvgRenderOn,
} from '../src/client/workbench/svg-render-settings.ts'

afterEach(() => {
  resetSvgRenderOn()
})

function makeOwner(blocks: Array<{ kind: string; text?: string }>): unknown {
  return {
    turn: {
      data: {
        get(key: string) {
          if (key !== 'turn-tail') return undefined
          return { closing: { blocks } }
        },
      },
    },
  }
}

const SIMPLE_SVG =
  '<svg width="120" height="60" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="100" height="40" rx="8" fill="#4c8dff"/></svg>'

describe('isStandardSvg', () => {
  it('accepts a complete <svg>…</svg> with at least one element', () => {
    expect(isStandardSvg(SIMPLE_SVG)).toBe(true)
  })

  it('rejects non-svg text', () => {
    expect(isStandardSvg('hello world')).toBe(false)
  })

  it('rejects an unclosed svg', () => {
    expect(isStandardSvg('<svg><rect/></svg')).toBe(false)
  })

  it('rejects an empty inner (no element)', () => {
    expect(isStandardSvg('<svg width="10"></svg>')).toBe(false)
  })

  it('rejects nested <svg inside (cross-line garbage guard)', () => {
    expect(isStandardSvg('<svg><svg></svg></svg>')).toBe(false)
  })

  it('rejects text mentioning <svg>…</svg> that swallowed a foreign closing tag', () => {
    // 正文表格/字面量里 “<svg>…</svg>” 会跨行吃到别处的 </svg>，内部混入 <svg 字样
    expect(isStandardSvg('<svg>见上表 <svg width="1"/></svg>')).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    expect(isStandardSvg(`\n  ${SIMPLE_SVG}\n`)).toBe(true)
  })
})

describe('sanitizeSvg', () => {
  it('strips script blocks', () => {
    const raw = `<svg><script>alert(1)</script><rect/></svg>`
    expect(sanitizeSvg(raw)).toBe('<svg><rect/></svg>')
  })

  it('strips foreignObject blocks', () => {
    const raw = `<svg><foreignObject><div>x</div></foreignObject><rect/></svg>`
    expect(sanitizeSvg(raw)).toBe('<svg><rect/></svg>')
  })

  it('strips on* event attributes', () => {
    const raw = `<svg onload="alert(1)"><rect onclick="x()"/></svg>`
    const clean = sanitizeSvg(raw)
    expect(clean).not.toBeNull()
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('onclick')
  })

  it('returns null when the result is no longer a standard svg', () => {
    expect(sanitizeSvg('not an svg')).toBeNull()
  })
})

describe('extractSvgs', () => {
  it('extracts a fenced ```svg block', () => {
    const text = `先说明\n\n\`\`\`svg\n${SIMPLE_SVG}\n\`\`\`\n\n结束`
    expect(extractSvgs(text)).toEqual([SIMPLE_SVG])
  })

  it('extracts a standalone <svg> tag in prose', () => {
    const text = `结果如图：${SIMPLE_SVG} 就是这样`
    expect(extractSvgs(text)).toEqual([SIMPLE_SVG])
  })

  it('dedupes when fence and prose hit the same svg', () => {
    const text = `\`\`\`svg\n${SIMPLE_SVG}\n\`\`\`\n正文 ${SIMPLE_SVG}`
    expect(extractSvgs(text)).toEqual([SIMPLE_SVG])
  })

  it('extracts multiple distinct svgs', () => {
    const other = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>'
    const text = `\`\`\`svg\n${SIMPLE_SVG}\n\`\`\`\n${other}`
    expect(extractSvgs(text)).toEqual([SIMPLE_SVG, other])
  })

  it('returns empty for plain text and svg mentions that are not complete tags', () => {
    expect(extractSvgs('普通文字，没有图')).toEqual([])
    expect(extractSvgs('我说的是 <svg> 标签，但没有完整闭合')).toEqual([])
  })

  it('rejects garbage cross-line match but keeps a real svg', () => {
    const text = `| a | b |\n|---|---|\n| <svg> | </svg> |\n\n${SIMPLE_SVG}`
    expect(extractSvgs(text)).toEqual([SIMPLE_SVG])
  })
})

describe('selectSvgTail', () => {
  it('merges multiple text blocks before extracting (fence spanning blocks)', () => {
    const owner = makeOwner([
      { kind: 'text', text: '```svg\n' },
      { kind: 'text', text: `${SIMPLE_SVG}\n` },
      { kind: 'text', text: '```' },
    ])
    expect(selectSvgTail(owner)).toEqual([SIMPLE_SVG])
  })

  it('returns null when no closing tail exists', () => {
    expect(selectSvgTail({ turn: { data: { get: () => undefined } } })).toBeNull()
  })

  it('returns null when no svg is present', () => {
    expect(selectSvgTail(makeOwner([{ kind: 'text', text: '没有图' }]))).toBeNull()
  })

  it('ignores non-text blocks', () => {
    const owner = makeOwner([
      { kind: 'tool', text: SIMPLE_SVG },
      { kind: 'text', text: SIMPLE_SVG },
    ])
    expect(selectSvgTail(owner)).toEqual([SIMPLE_SVG])
  })

  it('returns null for a malformed owner instead of throwing', () => {
    expect(selectSvgTail(null)).toBeNull()
    expect(selectSvgTail(undefined)).toBeNull()
  })
})

describe('selectSvgTailGated (设置开关门控)', () => {
  it('returns matches when the switch is on (default)', () => {
    const owner = makeOwner([{ kind: 'text', text: SIMPLE_SVG }])
    expect(selectSvgTailGated(owner)).toEqual([SIMPLE_SVG])
  })

  it('returns null when the switch is off', () => {
    setSvgRenderOn(false)
    const owner = makeOwner([{ kind: 'text', text: SIMPLE_SVG }])
    expect(selectSvgTailGated(owner)).toBeNull()
  })
})

describe('SVG_RENDER_EXAMPLE (设置面板 tip 示例)', () => {
  it('is a legal standard svg (will actually render)', () => {
    expect(isStandardSvg(SVG_RENDER_EXAMPLE)).toBe(true)
    expect(sanitizeSvg(SVG_RENDER_EXAMPLE)).toBe(SVG_RENDER_EXAMPLE)
  })
})
