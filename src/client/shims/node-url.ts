/** Browser stub for a leaked `node:url` import. */
export function fileURLToPath(url: string | URL): string {
  const href = typeof url === 'string' ? url : url.href
  if (!href.startsWith('file:')) return href
  let path = decodeURIComponent(href.replace(/^file:\/\//, ''))
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
  return path
}
