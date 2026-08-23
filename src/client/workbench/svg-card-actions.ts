/**
 * 会话渲染增强 · SVG 卡片操作（纯逻辑，无 React 依赖，可独立单测）。
 *
 * 为卡片右上角 "..." 菜单提供三个能力：
 *  1. svgToHtml / downloadBlob —— 下载为独立 HTML 文档；
 *  2. svgToPng / downloadBlob  —— 下载为 PNG 图片（canvas 栅格化，白底）；
 *  3. copyText                  —— 复制 SVG 代码到剪贴板（clipboard + 降级）。
 */

/** 把 SVG 包成可独立打开的 HTML 文档（居中、白底、自适应宽度）。 */
export function svgToHtml(svg: string): string {
  const style = [
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff}',
    'svg{max-width:100%;height:auto}',
  ].join('')
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SVG</title>',
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    svg,
    '</body>',
    '</html>',
  ].join('\n')
}

/** 触发浏览器下载一个 Blob。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延迟回收，避免部分浏览器在点击前就失效
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

/** 解析 SVG 的渲染尺寸：viewBox 优先，其次 width/height，缺省 300×150。 */
export function svgViewSize(svg: string): { width: number; height: number } {
  let root: Element | null = null
  try {
    const doc = new DOMParser().parseFromString(svg, 'application/xml')
    root = doc.documentElement
  } catch { /* fall through to defaults */ }
  const attr = (name: string): string | undefined => root?.getAttribute(name) ?? undefined
  const viewBox = attr('viewBox')
  if (viewBox !== undefined) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  const w = Number.parseFloat(attr('width') ?? '')
  const h = Number.parseFloat(attr('height') ?? '')
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h }
  }
  return { width: 300, height: 150 }
}

/**
 * SVG → PNG Blob（canvas 栅格化，scale 放大倍数，白底）。
 * 注意：SVG 内若引用外部资源（<image href> 外链等）受 canvas 污染策略影响，
 * 本插件渲染的都是 agent 回答中的内联 SVG，通常无此问题。
 */
export function svgToPng(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const { width, height } = svgViewSize(svg)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const ctx = canvas.getContext('2d')
        if (ctx === null) throw new Error('canvas 2d context unavailable')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((out) => {
          if (out !== null) resolve(out)
          else reject(new Error('canvas.toBlob returned null'))
        }, 'image/png')
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG image failed to load'))
    }
    img.src = url
  })
}

/** 复制文本到剪贴板：优先 Clipboard API，失败降级到 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
