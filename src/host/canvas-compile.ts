/**
 * Host-side Canvas TSX → JS transpile (uses sucrase; Node only).
 */
import { transform } from 'sucrase'
import {
  mountCanvasComponent,
  type CanvasCompileFail,
  type CanvasTranspileResult,
  validateCanvasSource,
} from '../shared/canvas-prepare.ts'

export function transpileCanvasSource(source: string): CanvasTranspileResult {
  const validated = validateCanvasSource(source)
  if (!validated.ok) return validated
  try {
    const code = transform(validated.prepared, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
      production: true,
    }).code
    return { ok: true, code }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Canvas 编译失败：${detail}` }
  }
}

/** Host test helper: transpile + mount when React is available. */
export function compileCanvasOnHost(
  source: string,
  React: typeof import('react'),
): { ok: true } | CanvasCompileFail {
  const transpiled = transpileCanvasSource(source)
  if (!transpiled.ok) return transpiled
  const mounted = mountCanvasComponent(transpiled.code, React)
  return mounted.ok ? { ok: true } : mounted
}
