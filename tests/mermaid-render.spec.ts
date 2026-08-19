// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/workbench/mermaid-loader.ts', async () => {
  const mermaid = (await import('mermaid')).default
  return {
    mermaidVendorUrl: () => '/git/vendor/mermaid.js?rev=test',
    loadMermaid: async () => mermaid,
  }
})

import { renderMermaidBlocks } from '../src/client/workbench/mermaid-render.ts'

const classes = { host: 'host', error: 'error' }
const labels = { fail: 'fail', loading: 'loading', loadFail: 'load-fail' }

const originalGetBBox = (window.SVGElement.prototype as unknown as { getBBox?: () => unknown }).getBBox
beforeEach(() => {
  ;(window.SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 })
})
afterEach(() => {
  ;(window.SVGElement.prototype as unknown as { getBBox?: () => unknown }).getBBox = originalGetBBox
})

describe('renderMermaidBlocks', () => {
  it('renders a flowchart code block into an svg', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    expect(root.querySelector('pre')).toBeNull()
    const svg = root.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-roledescription')).toBe('flowchart-v2')
  })

  it('leaves non-mermaid blocks untouched', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-ts">const a = 1</code></pre><pre><code class="language-mermaid">pie title X\n  "A" : 1</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    expect(root.querySelectorAll('pre').length).toBe(1)
    expect(root.querySelectorAll('svg').length).toBe(1)
  })

  it('keeps source visible in an error box on parse failure', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A --></code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    const errorBox = root.querySelector('div.error')
    expect(errorBox).not.toBeNull()
    expect(errorBox?.textContent).toContain('fail')
    expect(errorBox?.textContent).toContain('A -->')
    expect(root.querySelector('svg')).toBeNull()
  })

  it('honours cancellation mid-render', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => true)
    expect(found).toBe(0)
    expect(root.querySelectorAll('pre').length).toBe(1)
  })
})
