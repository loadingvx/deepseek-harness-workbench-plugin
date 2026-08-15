import { describe, expect, it } from 'vitest'
import { buildFilterTree, entryMatchesFilter, shouldSkipSearchDir } from '../src/shared/file-filter.ts'

describe('entryMatchesFilter', () => {
  it('matches a file name or path fragment, case-insensitively', () => {
    expect(entryMatchesFilter('FileTree.tsx', 'src/client/workbench/FileTree.tsx', 'filetree')).toBe(true)
    expect(entryMatchesFilter('api.ts', 'src/client/api.ts', 'CLIENT/API')).toBe(true)
    expect(entryMatchesFilter('README.md', 'README.md', 'git')).toBe(false)
  })

  it('treats .ts and *.tsx as extension filters', () => {
    expect(entryMatchesFilter('a.ts', 'src/a.ts', '.ts')).toBe(true)
    expect(entryMatchesFilter('a.tsx', 'src/a.tsx', '*.tsx')).toBe(true)
    expect(entryMatchesFilter('a.ts', 'src/a.ts', '*.tsx')).toBe(false)
    expect(entryMatchesFilter('.env', '.env', '.env')).toBe(true)
    expect(entryMatchesFilter('.env.local', '.env.local', '.env')).toBe(true)
  })

  it('does not treat the query as a regular expression', () => {
    expect(entryMatchesFilter('ab', 'ab', 'a+')).toBe(false)
    expect(entryMatchesFilter('a+', 'a+', 'a+')).toBe(true)
  })
})

describe('shouldSkipSearchDir', () => {
  it('skips heavy folders unless the query names them', () => {
    expect(shouldSkipSearchDir('.git', 'readme')).toBe(true)
    expect(shouldSkipSearchDir('node_modules', 'react')).toBe(true)
    expect(shouldSkipSearchDir('node_modules', 'node_modules/react')).toBe(false)
    expect(shouldSkipSearchDir('src', 'readme')).toBe(false)
  })
})

describe('buildFilterTree', () => {
  it('rebuilds ancestor folders around matching files', () => {
    const tree = buildFilterTree([
      { name: 'FileTree.tsx', path: 'src/client/workbench/FileTree.tsx', kind: 'file' },
      { name: 'api.ts', path: 'src/client/api.ts', kind: 'file' },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.name).toBe('src')
    expect(tree[0]?.children[0]?.name).toBe('client')
    expect(tree[0]?.children[0]?.children.map(item => item.name)).toEqual(['workbench', 'api.ts'])
  })
})
