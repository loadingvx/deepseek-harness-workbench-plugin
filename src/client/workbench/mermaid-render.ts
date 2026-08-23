import { renderMermaidSVG } from 'beautiful-mermaid'
import { mermaidRenderOptions } from './mermaid-theme.ts'

export interface MermaidHostClasses {
  host: string
  error: string
}

export interface MermaidLabels {
  fail: string
  loading: string
  loadFail: string
}

function mermaidBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('pre > code.language-mermaid'))
    .map((code) => code.parentElement)
    .filter((pre): pre is HTMLElement => pre !== null)
}

/**
 * Render every mermaid fenced block inside root into an SVG diagram via
 * beautiful-mermaid (bundled in client.js). Blocks are processed sequentially;
 * unsupported syntax or parse errors keep the source visible in an error box.
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

  const options = mermaidRenderOptions(root)
  let found = 0
  for (const { host, source } of hosts) {
    if (isCancelled()) return found
    found += 1
    if (source.trim() === '') {
      host.textContent = ''
      continue
    }
    try {
      const svg = renderMermaidSVG(source, options)
      if (isCancelled()) return found
      host.textContent = ''
      host.innerHTML = svg
    } catch (error) {
      if (isCancelled()) return found
      host.className = classes.error
      host.textContent = labels.fail + '\n\n' + source
      host.title = error instanceof Error ? error.message : String(error)
    }
  }
  return found
}
