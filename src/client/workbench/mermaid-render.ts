import mermaid from 'mermaid'

let initialized = false
let sequence = 0

function initMermaid(): void {
  if (initialized) return
  initialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  })
}

export interface MermaidHostClasses {
  host: string
  error: string
}

/**
 * Render every mermaid fenced block inside root into an SVG diagram using the
 * official mermaid.js renderer. Blocks are processed sequentially; a block
 * that fails to parse keeps its source text visible inside an error box with
 * the parser message as a tooltip. Returns the number of mermaid blocks found.
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  classes: MermaidHostClasses,
  failLabel: string,
  isCancelled: () => boolean,
): Promise<number> {
  const codes = Array.from(root.querySelectorAll('pre > code.language-mermaid'))
  if (codes.length === 0) return 0
  initMermaid()
  let found = 0
  for (const code of codes) {
    if (isCancelled()) return found
    const pre = code.parentElement
    if (pre === null) continue
    const source = code.textContent ?? ''
    const host = document.createElement('div')
    host.className = classes.host
    pre.replaceWith(host)
    found += 1
    if (source.trim() === '') continue
    try {
      const { svg, bindFunctions } = await mermaid.render('dsw-mmd-' + (++sequence), source)
      if (isCancelled()) return found
      host.innerHTML = svg
      bindFunctions?.(host)
    } catch (error) {
      if (isCancelled()) return found
      host.className = classes.error
      host.textContent = failLabel + '\n\n' + source
      host.title = error instanceof Error ? error.message : String(error)
    }
  }
  return found
}
