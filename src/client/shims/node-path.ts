/** Minimal POSIX path used if a client dependency still imports `node:path`. */
export const sep = '/'

export function join(...parts: string[]): string {
  const joined = parts.filter(part => part !== '').join('/')
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  const result = out.join('/')
  return joined.startsWith('/') ? `/${result}` : result
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  if (i <= 0) return i === 0 ? '/' : '.'
  return p.slice(0, i)
}

export function basename(p: string, ext?: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (ext !== undefined && ext !== '' && base.endsWith(ext) && base !== ext) {
    return base.slice(0, -ext.length)
  }
  return base
}

export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i) : ''
}

const path = { sep, join, dirname, basename, extname }
export default path
