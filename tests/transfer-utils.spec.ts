/**
 * Tests for the Files-tab transfer helpers used by the browser half.
 * 1. Absolute → workspace-relative conversion refuses anything outside the root.
 * 2. Upload target follows the selection: folder, file's folder, or root.
 * 3. Route URLs and error copy stay stable for both languages.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  transferActionFor,
  transferErrorMessage,
  transferRelativePath,
  transferTargetDir,
  transferUrl,
} from '../src/client/workbench/transfer-utils.ts'

const t = (key: string): string => `T:${key}`

describe('transfer helpers', () => {
  it('converts absolute paths to workspace-relative paths', () => {
    expect(transferRelativePath('/w/root', '/w/root/sub/a b.txt')).toBe('sub/a b.txt')
    expect(transferRelativePath('/w/root/', '/w/root')).toBe('')
    expect(transferRelativePath('/w/root', '/w/root/.hidden/x')).toBe('.hidden/x')
  })

  it('rejects paths outside the workspace and traversal shapes', () => {
    expect(() => transferRelativePath('/w/root', '/w/other/x')).toThrow()
    expect(() => transferRelativePath('/w/root', '/w/root/../x')).toThrow()
    expect(() => transferRelativePath('/w/root', '/w/root/..')).toThrow()
    expect(() => transferRelativePath('/w/root', '/w/root/a\\b')).toThrow()
    expect(() => transferRelativePath('/w/root', '/w/root/\0x')).toThrow()
  })

  it('targets the selected folder, a file’s folder, or the root', () => {
    expect(transferTargetDir('/w/root', null)).toBe('')
    expect(transferTargetDir('/w/root', { path: '/w/root/sub', kind: 'directory' })).toBe('sub')
    expect(transferTargetDir('/w/root', { path: '/w/root/sub/a.txt', kind: 'file' })).toBe('sub')
    expect(transferTargetDir('/w/root', { path: '/w/root/a.txt', kind: 'file' })).toBe('')
    expect(transferTargetDir('/w/root', { path: '/w/root', kind: 'directory' })).toBe('')
  })

  it('picks the download route for the entry kind', () => {
    expect(transferActionFor('file')).toBe('download')
    expect(transferActionFor('directory')).toBe('download-dir')
    expect(transferActionFor('other')).toBe('download')
  })

  it('builds query-safe URLs for unicode paths', () => {
    expect(transferUrl('download', 's1', 'sub/a b.txt')).toBe('/git/fs/download?sessionId=s1&path=sub%2Fa+b.txt')
    expect(transferUrl('download-dir', 's 1', '中文')).toBe('/git/fs/download-dir?sessionId=s+1&path=%E4%B8%AD%E6%96%87')
  })

  it('prefers the host message and falls back to status-shaped copy', () => {
    expect(transferErrorMessage(409, { ok: false, messageZh: '这个名字已经有人用了。' }, t)).toBe('这个名字已经有人用了。')
    expect(transferErrorMessage(409, {}, t)).toBe('T:transfer.exists')
    expect(transferErrorMessage(500, undefined, t)).toBe('T:transfer.failed (HTTP 500)')
  })

  it('formats sizes the way a file row should read them', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(12 * 1024 + 400)).toBe('12.4 KB')
    expect(formatBytes(100 * 1024)).toBe('100 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(3 * 1024 ** 3 + 512 * 1024 ** 2)).toBe('3.5 GB')
    expect(formatBytes(-1)).toBe('')
  })

  it('matches the host upload cap', () => {
    expect(MAX_UPLOAD_BYTES).toBe(256 * 1024 * 1024)
  })
})
