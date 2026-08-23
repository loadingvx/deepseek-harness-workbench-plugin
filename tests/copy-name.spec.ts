import { describe, expect, it } from 'vitest'
import { copyFileName, splitFileName, uniqueFileName } from '../src/shared/copy-name.ts'
import { fileManagerKind, fileManagerLocaleKey } from '../src/shared/file-manager.ts'

describe('copyFileName', () => {
  it('adds a locale suffix before the extension', () => {
    expect(copyFileName('README.md', false, '副本', [])).toBe('README 副本.md')
    expect(copyFileName('README.md', false, 'copy', ['README copy.md'])).toBe('README copy 2.md')
    expect(copyFileName('src', true, '副本', ['src', 'src 副本'])).toBe('src 副本 2')
  })

  it('keeps dotfiles as a stem', () => {
    expect(splitFileName('.env', false)).toEqual({ stem: '.env', ext: '' })
    expect(copyFileName('.env', false, 'copy', [])).toBe('.env copy')
  })
})

describe('uniqueFileName', () => {
  it('keeps the default name when free and numbers collisions', () => {
    expect(uniqueFileName('未命名.txt', false, [])).toBe('未命名.txt')
    expect(uniqueFileName('未命名.txt', false, ['未命名.txt'])).toBe('未命名 2.txt')
    expect(uniqueFileName('新建文件夹', true, ['新建文件夹', '新建文件夹 2'])).toBe('新建文件夹 3')
  })
})

describe('fileManagerKind', () => {
  it('maps common platforms to Finder / Explorer / Files', () => {
    expect(fileManagerKind('', 'MacIntel')).toBe('finder')
    expect(fileManagerKind('Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe('explorer')
    expect(fileManagerKind('', 'Linux x86_64')).toBe('files')
    expect(fileManagerLocaleKey('finder')).toBe('tree.reveal.finder')
  })
})
