// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { mountCanvasComponent, validateCanvasSource } from '../src/shared/canvas-prepare.ts'
import { compileCanvasOnHost, transpileCanvasSource } from '../src/host/canvas-compile.ts'

const MINIMAL = `
import { useState } from 'react';

export default function Demo() {
  const [n, setN] = useState(0);
  return <button type="button" onClick={() => { setN(n + 1); }}>{n}</button>;
}
`

describe('canvas prepare + host transpile', () => {
  it('transpiles and mounts a self-contained canvas component', () => {
    expect(compileCanvasOnHost(MINIMAL, React)).toEqual({ ok: true })
  })

  it('rejects empty sources', () => {
    expect(validateCanvasSource('   ')).toEqual({
      ok: false,
      message: 'Canvas 文件是空的，没有可预览的内容。',
    })
  })

  it('rejects sources without default export', () => {
    const result = validateCanvasSource('function X() { return null }')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('default export')
  })

  it('mounts transpiled code in the browser runtime', () => {
    const transpiled = transpileCanvasSource(MINIMAL)
    expect(transpiled.ok).toBe(true)
    if (!transpiled.ok) return
    const mounted = mountCanvasComponent(transpiled.code, React)
    expect(mounted.ok).toBe(true)
  })
})
