import type { FsDirEntry } from './types.ts'

export const MAX_FILTER_QUERY = 80
export const MAX_SEARCH_HITS = 200

export interface FilterNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: FilterNode[]
}

export function normalizeFileFilter(raw: string): string {
  return raw.trim().slice(0, MAX_FILTER_QUERY)
}

/** `.ts` / `*.tsx` 当成扩展名；其余按文件名或路径包含匹配（不走正则）。 */
export function entryMatchesFilter(name: string, path: string, query: string): boolean {
  const q = normalizeFileFilter(query).toLowerCase()
  if (q === '') return false
  const nameL = name.toLowerCase()
  const pathL = path.toLowerCase()
  if (q.startsWith('*.') && q.length > 2) return nameL.endsWith(q.slice(1))
  if (/^\.[a-z0-9]+$/i.test(q)) {
    return nameL === q || nameL.startsWith(`${q}.`) || nameL.endsWith(q)
  }
  return nameL.includes(q) || pathL.includes(q)
}

export function shouldSkipSearchDir(name: string, query: string): boolean {
  const q = normalizeFileFilter(query).toLowerCase()
  if (name === '.git' && !q.includes('.git')) return true
  if (name === 'node_modules' && !q.includes('node_modules')) return true
  return false
}

/** Rebuild a folder tree from flat search hits so the explorer stays recognizable. */
export function buildFilterTree(hits: readonly Pick<FsDirEntry, 'name' | 'path' | 'kind'>[]): FilterNode[] {
  const byPath = new Map<string, FilterNode>()

  const ensure = (path: string, kind: 'file' | 'directory', name: string): FilterNode => {
    const existing = byPath.get(path)
    if (existing !== undefined) {
      if (kind === 'directory') existing.kind = 'directory'
      return existing
    }
    const node: FilterNode = { name, path, kind, children: [] }
    byPath.set(path, node)
    return node
  }

  for (const hit of hits) {
    const parts = hit.path.split('/').filter(part => part !== '')
    let acc = ''
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index] ?? ''
      const next = acc === '' ? name : `${acc}/${name}`
      const leaf = index === parts.length - 1
      ensure(next, leaf ? hit.kind : 'directory', name)
      acc = next
    }
  }

  const roots: FilterNode[] = []
  for (const node of byPath.values()) {
    const slash = node.path.lastIndexOf('/')
    const parent = slash === -1 ? '' : node.path.slice(0, slash)
    if (parent === '') {
      roots.push(node)
      continue
    }
    const parentNode = byPath.get(parent)
    if (parentNode !== undefined) parentNode.children.push(node)
    else roots.push(node)
  }

  const sortNodes = (nodes: FilterNode[]): void => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, 'zh')
    })
    for (const node of nodes) sortNodes(node.children)
  }
  sortNodes(roots)
  return roots
}
