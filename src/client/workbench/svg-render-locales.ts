/**
 * 会话渲染增强 · 翻译 key（中英文）。
 *
 * 按 GIT-MERGE-SOP L1「翻译外移」策略独立成模块：locales.ts 是上游合并最高频
 * 冲突文件，新二开翻译不再逐行插入其中，而是在 index.ts 注册时运行时合并进
 * workbench 命名空间，缩小合并冲突面。
 */

export const svgRenderZh = {
  'settings.section.svgRender': '会话渲染增强',
  'settings.svgRenderLabel': '渲染会话中的 SVG 标签',
  'settings.svgRenderOn': '开启SVG渲染',
  'settings.svgRenderOff': '关闭SVG渲染',
  'settings.svgRenderOnHint': 'SVG 渲染已开启：agent 回复中的 SVG 标签会在该条回答底部渲染为图片（点击关闭）',
  'settings.svgRenderOffHint': 'SVG 渲染已关闭：agent 回复中的 SVG 标签仅以代码形式显示（点击开启）',
  'settings.svgRenderTip': '开启后，agent 回复中以 ```svg 围栏代码块或完整 <svg>…</svg> 标签输出的内容，会在该条回答底部渲染为 SVG 图片。例如：',
  // 卡片右上角 "..." 菜单
  'svgCard.menu': 'SVG 操作',
  'svgCard.downloadHtml': '下载为 HTML',
  'svgCard.downloadImage': '下载为图片',
  'svgCard.copyCode': '复制代码',
  'svgCard.copied': '已复制',
  'svgCard.copyFailed': '复制失败',
  'svgCard.downloadImageFailed': '导出图片失败',
} satisfies Record<string, string>

export const svgRenderEn = {
  'settings.section.svgRender': 'Session rendering',
  'settings.svgRenderLabel': 'Render SVG tags in session',
  'settings.svgRenderOn': 'Enable SVG rendering',
  'settings.svgRenderOff': 'Disable SVG rendering',
  'settings.svgRenderOnHint': 'SVG rendering is on: SVG tags in agent replies render as images at the bottom of that reply (click to turn off)',
  'settings.svgRenderOffHint': 'SVG rendering is off: SVG tags in agent replies show as code only (click to turn on)',
  'settings.svgRenderTip': 'When enabled, SVG content the agent outputs as a ```svg fenced block or a complete <svg>…</svg> tag renders as an image at the bottom of that reply. For example:',
  // Card "..." menu
  'svgCard.menu': 'SVG actions',
  'svgCard.downloadHtml': 'Download as HTML',
  'svgCard.downloadImage': 'Download as image',
  'svgCard.copyCode': 'Copy code',
  'svgCard.copied': 'Copied',
  'svgCard.copyFailed': 'Copy failed',
  'svgCard.downloadImageFailed': 'Image export failed',
} satisfies Record<string, string>
