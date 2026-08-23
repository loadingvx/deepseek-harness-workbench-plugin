import { describe, expect, it } from 'vitest'
import {
  buildFileReference,
  clipboardFileRef,
  encodeFileRef,
  fileRefBaseName,
  fileRefChipAlignEnd,
  fileRefChipLabel,
  fileRefLabel,
  FILE_REF_SOURCE,
  normalizeRelPath,
  parseFileRef,
  serializeFileRef,
} from '../src/shared/file-ref.ts'
import { dragCarriesFileRef, fileRefExisting, installFileRefClient } from '../src/client/workbench/file-ref-client.ts'

describe('normalizeRelPath', () => {
  it('strips slashes and rejects parent segments', () => {
    expect(normalizeRelPath('/src/foo.ts')).toBe('src/foo.ts')
    expect(normalizeRelPath('src/../secret')).toBeNull()
    expect(normalizeRelPath('')).toBeNull()
  })
})

describe('fileRefLabel', () => {
  it('keeps the basename until a duplicate appears', () => {
    expect(fileRefLabel('index.ts', [])).toBe('index.ts')
    expect(fileRefLabel('index.ts', ['index.ts'])).toBe('index.ts · 2')
    expect(fileRefLabel('index.ts', ['index.ts', 'index.ts · 2'])).toBe('index.ts · 3')
  })
})

describe('file ref codec', () => {
  it('round-trips files and directories for the model form', () => {
    expect(fileRefBaseName('src/client/Workbench.tsx')).toBe('Workbench.tsx')
    expect(serializeFileRef(encodeFileRef('file', 'src/a.ts'))).toBe('src/a.ts')
    expect(serializeFileRef(encodeFileRef('directory', 'src'))).toBe('src/')
    expect(clipboardFileRef(encodeFileRef('directory', 'src/client'))).toBe('src/client/')
    expect(parseFileRef('src/plain.ts')).toEqual({ kind: 'file', relPath: 'src/plain.ts' })
  })

  it('builds an official insert payload', () => {
    const first = buildFileReference('file', 'src/index.ts')
    expect(first).toEqual({
      source: 'workbench-file',
      ref: 'f:src/index.ts',
      label: 'index.ts',
      clipboardText: 'src/index.ts',
    })
    const second = buildFileReference('file', 'lib/index.ts', [first!])
    expect(second?.label).toBe('index.ts · 2')
    expect(second?.ref).toBe('f:lib/index.ts')
  })

  it('reuses the label when the same file is attached again', () => {
    const first = buildFileReference('file', 'src/index.ts')!
    expect(fileRefChipLabel('file', 'src/index.ts', [first])).toBe('index.ts')
    expect(buildFileReference('file', 'src/index.ts', [first])?.label).toBe('index.ts')
    expect(buildFileReference('file', 'lib/index.ts', [first])?.label).toBe('index.ts · 2')
  })

  it('does not rename when the earlier chip has no ref', () => {
    expect(buildFileReference('file', 'src/index.ts', [{ label: 'index.ts' }])?.label).toBe('index.ts')
  })
})

describe('fileRefChipAlignEnd', () => {
  it('keeps about 8 characters centered and sends longer names to the end', () => {
    expect(fileRefChipAlignEnd('a.ts')).toBe(false)
    expect(fileRefChipAlignEnd('index.ts')).toBe(false)
    expect(fileRefChipAlignEnd('Workbench.tsx')).toBe(true)
  })
})

describe('fileRefExisting', () => {
  it('keeps only this source\'s chips', () => {
    expect(fileRefExisting([
      { source: FILE_REF_SOURCE, ref: 'f:src/index.ts', label: 'index.ts' },
      { source: 'subagent', ref: 'helper', label: 'helper' },
    ])).toEqual([{ source: FILE_REF_SOURCE, ref: 'f:src/index.ts', label: 'index.ts' }])
  })
})

describe('dragCarriesFileRef', () => {
  it('gates on the custom path type', () => {
    expect(dragCarriesFileRef(null)).toBe(false)
    expect(dragCarriesFileRef({ types: ['text/plain'] } as DataTransfer)).toBe(false)
    expect(dragCarriesFileRef({ types: ['application/x-dsh-path', 'text/plain'] } as DataTransfer)).toBe(true)
  })
})

describe('installFileRefClient.onPick', () => {
  it('reuses the chip label when the same file is picked again', () => {
    let source: { onPick: (pick: { candidate: { name: string }; session?: { sessionId: string } }) => unknown } | undefined
    const api = installFileRefClient({
      effect: (fn) => { fn() },
      get: () => undefined,
      inputTriggers: {
        registerSource(src: typeof source) {
          source = src
          return () => {}
        },
      },
    }, {} as never)
    api.rememberOccurrences('s1', [{ ref: 'f:src/index.ts', label: 'index.ts' }])
    const picked = source?.onPick({
      candidate: { name: 'src/index.ts' },
      session: { sessionId: 's1' },
    }) as { insert?: { label: string } } | undefined
    expect(picked?.insert?.label).toBe('index.ts')
  })
})

describe('installFileRefClient.insertChip', () => {
  it('bails insert-reference on the session scope and refuses a busy composer', () => {
    const notices: string[] = []
    const calls: unknown[] = []
    const actx = {
      bail(_thisArg: unknown, name: string, payload: unknown) {
        calls.push({ name, payload })
        return true
      },
      get() {
        return {
          input: {
            for: () => ({
              notify: (_level: string, text: string) => { notices.push(text) },
              snapshot: {
                occurrences: [
                  { source: FILE_REF_SOURCE, ref: 'f:src/a.ts', label: 'a.ts' },
                ],
              },
            }),
          },
        }
      },
    }
    const api = installFileRefClient({
      effect: () => {},
      get: () => undefined,
      sessions: { scope: () => actx },
    }, {} as never)
    const t = (key: string) => key
    expect(api.insertChip({
      sessionId: 's1',
      kind: 'file',
      relPath: 'src/a.ts',
      span: { start: 0, end: 0, draftRev: 4 },
      existing: [],
      phase: 'submitting',
    }, t)).toBe(false)
    expect(notices).toEqual(['fileRef.busy'])
    expect(api.insertChip({
      sessionId: 's1',
      kind: 'file',
      relPath: 'src/a.ts',
      span: { start: 2, end: 2, draftRev: 4 },
      existing: [],
      phase: 'plain',
    }, t)).toBe(true)
    expect(calls).toEqual([{
      name: 'slash/input-insert-reference',
      payload: {
        reference: {
          source: 'workbench-file',
          ref: 'f:src/a.ts',
          label: 'a.ts',
          clipboardText: 'src/a.ts',
        },
        span: { start: 2, end: 2, draftRev: 4 },
      },
    }])
    expect(api.insertChip({
      sessionId: 's1',
      kind: 'file',
      relPath: 'src/a.ts',
      span: { start: 4, end: 4, draftRev: 5 },
      existing: [{ ref: 'f:src/a.ts', label: 'a.ts' }],
      phase: 'plain',
    }, t)).toBe(true)
    expect((calls[1] as { payload: { reference: { label: string } } }).payload.reference.label).toBe('a.ts')
  })
})
