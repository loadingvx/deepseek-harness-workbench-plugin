// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMermaidBlocks } from '../src/client/workbench/mermaid-render.ts'

const classes = { host: 'host', error: 'error' }
const labels = { fail: 'fail', loading: 'loading', loadFail: 'load-fail' }

describe('renderMermaidBlocks', () => {
  it('renders a flowchart code block into an svg', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    expect(root.querySelector('pre')).toBeNull()
    expect(root.querySelector('svg')).not.toBeNull()
  })

  it('leaves non-mermaid blocks untouched', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-ts">const a = 1</code></pre><pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    expect(root.querySelectorAll('pre').length).toBe(1)
    expect(root.querySelectorAll('svg').length).toBe(1)
  })

  it('shows an error box for unsupported diagram types', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">pie title X\n  "A" : 1</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    const errorBox = root.querySelector('div.error')
    expect(errorBox).not.toBeNull()
    expect(errorBox?.textContent).toContain('fail')
    expect(root.querySelector('svg')).toBeNull()
  })

  it('keeps source visible in an error box on parse failure', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">not a diagram</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => false)
    expect(found).toBe(1)
    const errorBox = root.querySelector('div.error')
    expect(errorBox).not.toBeNull()
    expect(errorBox?.textContent).toContain('fail')
    expect(errorBox?.textContent).toContain('not a diagram')
    expect(root.querySelector('svg')).toBeNull()
  })

  it('honours cancellation before rendering', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">graph TD\n  A-->B</code></pre>'
    const found = await renderMermaidBlocks(root, classes, labels, () => true)
    expect(found).toBe(0)
    expect(root.querySelectorAll('pre').length).toBe(1)
  })
})
