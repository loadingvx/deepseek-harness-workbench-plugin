/**
 * 会话渲染增强 · SVG 回答可视化（能力移植自 wake-dsh-plu-svg-viewer 动态插件）
 *
 * 原则：只认标准规范格式，逻辑极简，稳定优先。
 *  1. 合并该 turn 全部 text block 后统一提取（流式输出会把回答切成多个 block）；
 *  2. 标准校验 isStandardSvg：完整 <svg …>…</svg>（<svg 开头 + </svg> 结尾 + 内部至少一个元素）；
 *  3. 防跨行垃圾匹配：SVG 内部不得再出现 <svg 字样。正文表格/字面量里
 *     “<svg>…</svg>” 这类文字会从 <svg> 一直吃到别处的 </svg>，产生以 <svg
 *     开头、</svg> 结尾但内部混着 <svg 字样的垃圾串，此校验将其拒绝；
 *  4. 最小安全清洗：script / foreignObject / on* 事件属性；
 *  5. 支持两种标准写法：```svg 围栏内、或正文中独立的完整 <svg> 标签。
 *
 * 本文件为纯逻辑（无 React / 无 DOM），可独立单测。
 */

/** 标准校验：完整 <svg>…</svg>，内部至少一个元素，且内部不再嵌套 <svg */
export function isStandardSvg(raw: string): boolean {
  const t = String(raw).trim()
  if (!/^<svg[\s>]/i.test(t) || !/<\/svg\s*>$/i.test(t)) return false
  const inner = t.replace(/^<svg[^>]*>/i, '').replace(/<\/svg\s*>$/i, '')
  if (inner.indexOf('<svg') !== -1) return false
  return /<[a-zA-Z]/.test(inner)
}

/** 最小安全清洗：移除可执行内容载体与事件属性，其余原样保留 */
export function sanitizeSvg(raw: string): string | null {
  let s = String(raw)
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
  return isStandardSvg(s) ? s.trim() : null
}

/** 从一段文本提取所有标准 SVG：围栏内优先，正文中完整的 <svg> 标签其次，去重 */
export function extractSvgs(text: string): string[] {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const fenceRe = /```svg\s*\n?([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1].trim()
    if (isStandardSvg(body) && !Object.prototype.hasOwnProperty.call(seen, body)) {
      seen[body] = true
      out.push(body)
    }
  }
  const rest = text.replace(fenceRe, '')
  const rawRe = /<svg[\s>][\s\S]*?<\/svg\s*>/gi
  let r: RegExpExecArray | null
  while ((r = rawRe.exec(rest)) !== null) {
    const svg = r[0].trim()
    if (isStandardSvg(svg) && !Object.prototype.hasOwnProperty.call(seen, svg)) {
      seen[svg] = true
      out.push(svg)
    }
  }
  return out
}

/** turnTail 链 select 入参的最小结构（owner.turn.data.get('turn-tail')） */
export interface TurnTailOwner {
  turn: {
    data: {
      get(key: string): unknown
    }
  }
}

interface TurnTailClosing {
  closing?: {
    blocks?: Array<{ kind?: string; text?: string }>
  }
}

/** turnTail 链路由：合并全部 text block 后提取，仅当含标准 SVG 时匹配 */
export function selectSvgTail(owner: unknown): string[] | null {
  try {
    const tail = (owner as TurnTailOwner | undefined)?.turn?.data?.get('turn-tail') as
      | TurnTailClosing
      | undefined
    const closing = tail?.closing
    if (!closing) return null
    let full = ''
    const blocks = closing.blocks || []
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      if (block && block.kind === 'text' && typeof block.text === 'string') {
        full += block.text + '\n'
      }
    }
    const svgs = extractSvgs(full)
    return svgs.length === 0 ? null : svgs
  } catch (err) {
    console.error('svg-tail select failed', err)
    return null
  }
}

/**
 * 设置面板 tip 中展示的合法简单 SVG 示例：符合 isStandardSvg 标准，
 * 用户据此知道 agent 回复怎样的标签会在会话底部被渲染为 SVG。
 */
export const SVG_RENDER_EXAMPLE =
  '<svg width="120" height="60" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="10" y="10" width="100" height="40" rx="8" fill="#4c8dff"/>' +
  '<text x="60" y="38" font-size="16" fill="#ffffff" text-anchor="middle">Hello</text>' +
  '</svg>'
