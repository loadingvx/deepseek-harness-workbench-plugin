import type { RenderOptions } from 'beautiful-mermaid'

/**
 * Map workbench design tokens to beautiful-mermaid colors.
 * CSS variables keep diagrams in sync when the user switches light/dark theme.
 */
export function mermaidRenderOptions(_root?: HTMLElement | null): RenderOptions {
  return {
    bg: 'var(--dsw-alias-bg-base)',
    fg: 'var(--dsw-alias-label-primary)',
    muted: 'var(--dsw-alias-label-secondary)',
    border: 'var(--dsw-alias-border-l2)',
    line: 'var(--dsw-alias-border-l1)',
    accent: 'var(--dsw-alias-label-primary)',
    surface: 'var(--dsw-alias-interactive-bg-hover)',
    transparent: true,
    font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  }
}
