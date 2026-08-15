import { describe, expect, it } from 'vitest'
import {
  joinWorkspaceFile, sanitizeTermId, suggestNewFileDir, termIdFromTabId, termSessionKey,
} from '../src/shared/new-file-path.ts'

describe('suggestNewFileDir', () => {
  it('uses the folder of the open file and falls back to the workspace root', () => {
    expect(suggestNewFileDir('src/client/api.ts', 'file')).toBe('src/client')
    expect(suggestNewFileDir('README.md', 'file')).toBe('')
    expect(suggestNewFileDir('', 'terminal')).toBe('')
  })
})

describe('joinWorkspaceFile', () => {
  it('joins a folder and a name, and rejects traversal', () => {
    expect(joinWorkspaceFile('src/client', '新建.ts')).toBe('src/client/新建.ts')
    expect(joinWorkspaceFile('', '未命名.txt')).toBe('未命名.txt')
    expect(joinWorkspaceFile('src', 'sub/a.ts')).toBe('src/sub/a.ts')
    expect(joinWorkspaceFile('src', '../secret')).toBeNull()
    expect(joinWorkspaceFile('', '')).toBeNull()
    expect(joinWorkspaceFile('src', 'a:b')).toBeNull()
  })
})

describe('term ids', () => {
  it('keeps a safe id and builds a session key', () => {
    expect(sanitizeTermId('abc-2')).toBe('abc-2')
    expect(sanitizeTermId('../x')).toBe('main')
    expect(termSessionKey('ws1', '2')).toBe('ws1::2')
    expect(termIdFromTabId('terminal:main')).toBe('main')
    expect(termIdFromTabId('terminal:171')).toBe('171')
  })
})
