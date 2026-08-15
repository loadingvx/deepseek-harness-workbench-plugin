import { describe, expect, it } from 'vitest'
import { breadcrumbParts } from '../src/client/workbench/breadcrumb-path.ts'

describe('breadcrumbParts', () => {
  it('splits a nested file path into crumbs', () => {
    expect(breadcrumbParts('src/client/workbench/FileTree.tsx')).toEqual([
      { name: 'src', path: 'src' },
      { name: 'client', path: 'src/client' },
      { name: 'workbench', path: 'src/client/workbench' },
      { name: 'FileTree.tsx', path: 'src/client/workbench/FileTree.tsx' },
    ])
  })

  it('treats empty and root-like paths as no crumbs', () => {
    expect(breadcrumbParts('')).toEqual([])
    expect(breadcrumbParts('.')).toEqual([])
  })
})
