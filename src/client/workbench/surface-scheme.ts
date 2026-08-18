/** Infer light/dark from a CSS background so native menus match the workbench theme. */

function parseCssColor(raw: string): [number, number, number] | null {
  const value = raw.trim()
  if (value === '') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1] ?? ''
    if (digits.length === 3) {
      const r = Number.parseInt(digits[0] + digits[0], 16)
      const g = Number.parseInt(digits[1] + digits[1], 16)
      const b = Number.parseInt(digits[2] + digits[2], 16)
      return [r, g, b]
    }
    const r = Number.parseInt(digits.slice(0, 2), 16)
    const g = Number.parseInt(digits.slice(2, 4), 16)
    const b = Number.parseInt(digits.slice(4, 6), 16)
    return [r, g, b]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i.exec(value)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return null
}

export function surfaceColorScheme(bg: string, fallback: 'light' | 'dark' = 'light'): 'light' | 'dark' {
  const rgb = parseCssColor(bg)
  if (rgb === null) return fallback
  const [r, g, b] = rgb
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return y < 0.45 ? 'dark' : 'light'
}

export function readDocumentColorScheme(el?: HTMLElement | null): 'light' | 'dark' {
  const target = el ?? (typeof document === 'undefined' ? null : document.documentElement)
  if (target === null) return 'light'
  const bg = getComputedStyle(target).getPropertyValue('--dsw-alias-bg-base')
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  return surfaceColorScheme(bg, prefersDark ? 'dark' : 'light')
}
