import { describe, expect, it } from 'vitest'
import {
  isLegacyXlsPath, isPreviewImagePath, isPreviewTablePath, previewKindOfPath,
} from '../src/shared/preview-kind.ts'

describe('previewKindOfPath', () => {
  it('classifies raster images as image previews', () => {
    expect(previewKindOfPath('shot.png')).toBe('image')
    expect(previewKindOfPath('docs/photo.jpg')).toBe('image')
    expect(previewKindOfPath('a/b/c.JPEG')).toBe('image')
    expect(previewKindOfPath('anim.gif')).toBe('image')
    expect(previewKindOfPath('icon.webp')).toBe('image')
    expect(previewKindOfPath('pic.avif')).toBe('image')
    expect(previewKindOfPath('favicon.ico')).toBe('image')
    expect(previewKindOfPath('logo.bmp')).toBe('image')
  })

  it('classifies spreadsheets and delimited text as table previews', () => {
    expect(previewKindOfPath('data.csv')).toBe('table')
    expect(previewKindOfPath('data.tsv')).toBe('table')
    expect(previewKindOfPath('book.xlsx')).toBe('table')
    expect(previewKindOfPath('legacy.xls')).toBe('table')
    expect(isPreviewTablePath('报表.csv')).toBe(true)
  })

  it('keeps SVG and text files in the regular editor', () => {
    expect(previewKindOfPath('icon.svg')).toBe(null)
    expect(previewKindOfPath('README.md')).toBe(null)
    expect(previewKindOfPath('main.ts')).toBe(null)
    expect(previewKindOfPath('LICENSE')).toBe(null)
    expect(previewKindOfPath('noext')).toBe(null)
    expect(previewKindOfPath('archive.zip')).toBe(null)
    expect(previewKindOfPath('doc.pdf')).toBe(null)
  })

  it('is case-insensitive and extension-anchored', () => {
    expect(previewKindOfPath('PHOTO.PNG')).toBe('image')
    expect(isPreviewImagePath('Shot.PNG')).toBe(true)
    expect(previewKindOfPath('notes.csv.bak')).toBe(null)
    expect(previewKindOfPath('data.csv/inside.txt')).toBe(null)
  })
})

describe('isLegacyXlsPath', () => {
  it('detects only the old binary Excel extension', () => {
    expect(isLegacyXlsPath('book.xls')).toBe(true)
    expect(isLegacyXlsPath('BOOK.XLS')).toBe(true)
    expect(isLegacyXlsPath('book.xlsx')).toBe(false)
    expect(isLegacyXlsPath('book.csv')).toBe(false)
  })
})
