/**
 * 会话渲染增强 · 开关偏好（页面级配置，localStorage 持久化，刷新不丢）。
 *
 * 与 svg-tail.ts 的纯提取逻辑分离：本模块只负责「是否开启会话中 SVG 标签渲染」
 * 这一个开关的读取 / 写入 / 订阅，并基于该开关组装 turnTail 链的 select 路由
 * （关闭时不匹配，返回 null——与 svg-viewer 无 SVG 时不渲染的行为一致）。
 */
import { useEffect, useState } from 'react'
import { readBoolFlag, writeBoolFlag } from './ui-flags.ts'
import { selectSvgTail } from './svg-tail.ts'

export const SVG_RENDER_ON_KEY = 'dsh-workbench-svg-render-on'

/** 出厂默认：开启（能力移植自 svg-viewer，保持其默认渲染行为）。 */
export const DEFAULT_SVG_RENDER_ON = true

let svgRenderOn = readBoolFlag(SVG_RENDER_ON_KEY, DEFAULT_SVG_RENDER_ON)
const listeners = new Set<(on: boolean) => void>()

export function getSvgRenderOn(): boolean {
  return svgRenderOn
}

export function setSvgRenderOn(value: boolean): void {
  if (svgRenderOn === value) return
  svgRenderOn = value
  writeBoolFlag(SVG_RENDER_ON_KEY, value)
  for (const fn of listeners) fn(value)
}

/** React useSyncExternalStore 风格订阅（模块级单例，供设置面板开关联动）。 */
export function subscribeSvgRenderOn(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 设置面板开关 hook：读当前值 + 订阅变化 + 写回偏好。 */
export function useSvgRenderOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getSvgRenderOn)
  useEffect(() => subscribeSvgRenderOn(setOn), [])
  return [on, setSvgRenderOn]
}

/** turnTail 链 select 路由：开关关闭时不匹配（返回 null，不渲染）。 */
export function selectSvgTailGated(owner: unknown): string[] | null {
  return getSvgRenderOn() ? selectSvgTail(owner) : null
}

/** 测试辅助：复位到出厂默认并清空持久化。 */
export function resetSvgRenderOn(): void {
  svgRenderOn = DEFAULT_SVG_RENDER_ON
  writeBoolFlag(SVG_RENDER_ON_KEY, svgRenderOn)
  for (const fn of listeners) fn(svgRenderOn)
}
