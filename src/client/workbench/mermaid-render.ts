import { loadMermaid } from './mermaid-loader.ts'

let initialized = false
let sequence = 0

export interface MermaidHostClasses {
  host: string
  error: string
}

export interface MermaidLabels {
  fail: string
  loading: string
  loadFail: string
}

function initMermaid(api: { initialize: (config: {
  startOnLoad: boolean
  securityLevel: string
  theme: string
  fontFamily: string
}) => void }): void {
  if (initialized) return
  initialized = true
  api.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  })
}

function mermaidBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('pre > code.language-mermaid'))
    .map((code) => code.parentElement)
    .filter((pre): pre is HTMLElement => pre !== null)
}

/**
 * Render every mermaid fenced block inside root into an SVG diagram using the
 * official mermaid.js renderer. The mermaid library is loaded on first use from
 * `/git/vendor/mermaid.js` so it is not part of the DSH boot `client.js`.
 * Blocks are processed sequentially; a block that fails to parse keeps its
 * source text visible inside an error box with the parser message as a tooltip.
 * Returns the number of mermaid blocks found.
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  classes: MermaidHostClasses,
  labels: MermaidLabels,
  isCancelled: () => boolean,
): Promise<number> {
  const pres = mermaidBlocks(root)
  if (pres.length === 0) return 0
  if (isCancelled()) return 0

  const hosts: Array<{ host: HTMLElement; source: string }> = []
  for (const pre of pres) {
    const code = pre.querySelector('code')
    const source = code?.textContent ?? ''
    const host = document.createElement('div')
    host.className = classes.host
    host.textContent = labels.loading
    pre.replaceWith(host)
    hosts.push({ host, source })
  }

  let mermaid
  try {
    mermaid = await loadMermaid()
  } catch (error) {
    if (isCancelled()) return hosts.length
    const detail = error instanceof Error ? error.message : String(error)
    for (const { host, source } of hosts) {
      host.className = classes.error
      host.textContent = labels.loadFail + (source.trim() === '' ? '' : '\n\n' + source)
      host.title = detail
    }
    return hosts.length
  }
  if (isCancelled()) return hosts.length
  initMermaid(mermaid)

  let found = 0
  for (const { host, source } of hosts) {
    if (isCancelled()) return found
    found += 1
    if (source.trim() === '') {
      host.textContent = ''
      continue
    }
    try {
      const { svg, bindFunctions } = await mermaid.render('dsw-mmd-' + (++sequence), source)
      if (isCancelled()) return found
      host.textContent = ''
      host.innerHTML = svg
      bindFunctions?.(host)
    } catch (error) {
      if (isCancelled()) return found
      host.className = classes.error
      host.textContent = labels.fail + '\n\n' + source
      host.title = error instanceof Error ? error.message : String(error)
    }
  }
  return found
}
