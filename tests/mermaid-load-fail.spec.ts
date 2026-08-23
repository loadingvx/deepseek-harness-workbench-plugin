// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/workbench/mermaid-loader.ts', () => ({
  loadMermaid: async () => {
    throw new Error('network')
  },
}))

import { renderMermaidBlocks } from '../src/client/workbench/mermaid-render.ts'

describe('renderMermaidBlocks load failure', () => {
  it('keeps source visible when the vendor script cannot load', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(
      root,
      { host: 'host', error: 'error' },
      { fail: 'fail', loading: 'loading', loadFail: 'load-fail' },
      () => false,
    )
    expect(found).toBe(1)
    const errorBox = root.querySelector('div.error')
    expect(errorBox?.textContent).toContain('load-fail')
    expect(errorBox?.textContent).toContain('A-->B')
    expect(root.querySelector('svg')).toBeNull()
  })
})
