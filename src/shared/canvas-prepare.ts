/**
 * Shared Canvas source preparation (no sucrase — safe for client bundle).
 */

export interface CanvasCompileFail {
  readonly ok: false
  readonly message: string
}

export interface CanvasTranspileOk {
  readonly ok: true
  readonly code: string
}

export type CanvasTranspileResult = CanvasTranspileOk | CanvasCompileFail

const IMPORT_RE = /^\s*import\s+[\s\S]*?;\s*$/gm

/** Strip react imports and rewrite default export for runtime injection. */
export function prepareCanvasSource(source: string): string {
  let code = source.replace(IMPORT_RE, '')
  const namedFn = /export\s+default\s+function\s+(\w+)/.exec(code)
  if (namedFn !== null) {
    const name = namedFn[1]
    code = code.replace(/export\s+default\s+function\s+(\w+)/, 'function $1')
    return `${code.trim()}\nconst __canvasDefault = ${name};`
  }
  const anonFn = /export\s+default\s+function\s*\(/.exec(code)
  if (anonFn !== null) {
    code = code.replace(/export\s+default\s+function/, 'const __canvasDefault = function')
    return code.trim()
  }
  if (/export\s+default/.test(code)) {
    code = code.replace(/export\s+default\s+/g, 'const __canvasDefault = ')
  }
  return code.trim()
}

export function validateCanvasSource(source: string): CanvasCompileFail | { ok: true; prepared: string } {
  const trimmed = source.trim()
  if (trimmed === '') {
    return { ok: false, message: 'Canvas 文件是空的，没有可预览的内容。' }
  }
  if (!/export\s+default/.test(trimmed)) {
    return { ok: false, message: 'Canvas 需要 default export 一个 React 组件。' }
  }
  return { ok: true, prepared: prepareCanvasSource(trimmed) }
}

export const CANVAS_RUNTIME_TAIL = [
  'if (typeof __canvasDefault !== "undefined") return __canvasDefault;',
  'return null;',
].join('\n')

/** Execute host-transpiled Canvas JS in the browser with React hooks injected. */
export function mountCanvasComponent(
  transpiledCode: string,
  React: typeof import('react'),
): { ok: true; Component: React.ComponentType } | CanvasCompileFail {
  try {
    const factory = new Function(
      'React',
      'useState',
      'useEffect',
      'useMemo',
      'useRef',
      'useCallback',
      'useReducer',
      'useId',
      'Fragment',
      `${transpiledCode}\n${CANVAS_RUNTIME_TAIL}`,
    ) as (
      react: typeof React,
      useState: typeof React.useState,
      useEffect: typeof React.useEffect,
      useMemo: typeof React.useMemo,
      useRef: typeof React.useRef,
      useCallback: typeof React.useCallback,
      useReducer: typeof React.useReducer,
      useId: typeof React.useId,
      Fragment: typeof React.Fragment,
    ) => unknown

    const component = factory(
      React,
      React.useState,
      React.useEffect,
      React.useMemo,
      React.useRef,
      React.useCallback,
      React.useReducer,
      React.useId,
      React.Fragment,
    )
    if (component === null || component === undefined) {
      return { ok: false, message: 'Canvas 没有找到可渲染的 default export。' }
    }
    if (typeof component !== 'function' && typeof component !== 'object') {
      return { ok: false, message: 'Canvas 的 default export 必须是 React 组件。' }
    }
    return { ok: true, Component: component as React.ComponentType }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Canvas 编译失败：${detail}` }
  }
}
