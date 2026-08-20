import { describe, expect, it } from 'vitest'
import {
  EDITOR_REF_SOURCE,
  buildEditorReference,
  clipEditorRefText,
  editorRefChipLabel,
  editorRefLabelOf,
  encodeEditorRef,
  normalizeEditorRefSnapshot,
  parseEditorRef,
  serializeEditorRef,
  serializeEditorRefRef,
} from '../src/shared/editor-ref.ts'

describe('normalizeEditorRefSnapshot', () => {
  it('rejects empty text', () => {
    expect(normalizeEditorRefSnapshot({ text: '   ', kind: 'selection' })).toBeNull()
  })

  it('defaults to selection kind and trims path', () => {
    expect(normalizeEditorRefSnapshot({ text: 'foo', path: '  a.ts  ' })).toEqual({ text: 'foo', kind: 'selection', path: 'a.ts' })
  })

  it('keeps file kind', () => {
    expect(normalizeEditorRefSnapshot({ text: 'foo', kind: 'file' })).toEqual({ text: 'foo', kind: 'file' })
  })
})

describe('editorRefLabelOf', () => {
  it('prefers the file path', () => {
    expect(editorRefLabelOf({ text: 'first line\nsecond', path: 'src/a.ts' })).toBe('src/a.ts')
  })

  it('falls back to the first line without a path', () => {
    expect(editorRefLabelOf({ text: 'first line\nsecond', path: '' })).toBe('first line')
  })

  it('clips long paths and long first lines', () => {
    const long = 'x'.repeat(60)
    expect(editorRefLabelOf({ text: 't', path: long })).toBe('x'.repeat(47) + '…')
    expect(editorRefLabelOf({ text: long, path: '' })).toBe('x'.repeat(47) + '…')
  })
})

describe('editorRefChipLabel', () => {
  it('dedupes an already-present label with a counter', () => {
    const snapshot = { text: 'foo', path: 'a.ts' }
    expect(editorRefChipLabel(snapshot, [])).toBe('a.ts')
    expect(editorRefChipLabel(snapshot, [{ label: 'a.ts' }])).toBe('a.ts · 2')
    expect(editorRefChipLabel(snapshot, [{ label: 'a.ts' }, { label: 'a.ts · 2' }])).toBe('a.ts · 3')
  })
})

describe('encode / parse round trip', () => {
  it('round-trips a selection snapshot', () => {
    const snapshot = { text: 'const a = 1', kind: 'selection' as const, path: 'src/x.ts' }
    expect(parseEditorRef(encodeEditorRef(snapshot))).toEqual(snapshot)
  })

  it('rejects unknown prefixes and garbage', () => {
    expect(parseEditorRef('n1:whatever')).toBeNull()
    expect(parseEditorRef('ed1:%7B')).toBeNull()
  })
})

describe('serializeEditorRef', () => {
  it('labels selections and whole files with the path as context', () => {
    expect(serializeEditorRef({ text: 'a', kind: 'selection', path: 'src/x.ts' })).toBe('【选中内容】：src/x.ts\n---\na')
    expect(serializeEditorRef({ text: 'a', kind: 'file', path: 'src/x.ts' })).toBe('【文件内容】：src/x.ts\n---\na')
    expect(serializeEditorRef({ text: 'a', kind: 'selection' })).toBe('【选中内容】\n---\na')
  })

  it('expires broken refs to a hint instead of crashing', () => {
    expect(serializeEditorRefRef('ed1:not-json')).toContain('已过期')
  })
})

describe('buildEditorReference', () => {
  it('builds a chip reference from a selection', () => {
    const ref = buildEditorReference({ text: 'foo', kind: 'selection', path: 'a.ts' })
    expect(ref).not.toBeNull()
    expect(ref!.source).toBe(EDITOR_REF_SOURCE)
    expect(ref!.label).toBe('a.ts')
    expect(parseEditorRef(ref!.ref)).toEqual({ text: 'foo', kind: 'selection', path: 'a.ts' })
  })

  it('rejects empty snapshots', () => {
    expect(buildEditorReference({ text: '  ', kind: 'file' })).toBeNull()
  })
})

describe('clipEditorRefText', () => {
  it('clips very long text at the 20k limit', () => {
    expect(clipEditorRefText('a'.repeat(25_000)).length).toBe(20_000)
  })
})
