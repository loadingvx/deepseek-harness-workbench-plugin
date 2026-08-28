import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildNetReference, encodeNetRef } from '../src/shared/browser-net-ref.ts'

/** Optional override; otherwise ./deepseek-harness (gitignored symlink) beside this repo. */
const harnessRoot = process.env.DSH_HARNESS
  ? resolve(process.env.DSH_HARNESS)
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'deepseek-harness')

const machinePath = join(
  harnessRoot,
  'packages/client/ui-conversation/src/client/input/machine.ts',
)
const hasHarnessMachine = existsSync(machinePath)

type InputMachineInstance = {
  state: {
    draft: string
    draftRev: number
    occurrences: Array<{ ref: string; label: string }>
  }
  dispatch: (event: unknown) => void
}
type InputMachineCtor = new () => InputMachineInstance
type ReferenceDraftText = (reference: Pick<{ label: string }, 'label'>) => string

type HarnessMachineMod = {
  InputMachine: InputMachineCtor
  /** Current harness: draft holds one U+FFFC per chip. */
  PLACEHOLDER?: string
  /** Older harness: chip text was a serialized label string. */
  referenceDraftText?: ReferenceDraftText
}

/**
 * Chip token as it appears in the draft. Current InputMachine uses PLACEHOLDER;
 * older checkouts still export referenceDraftText. Keep both so macOS / WSL
 * checkouts of different harness revisions stay green.
 */
function chipInDraft(mod: HarnessMachineMod, reference: { label: string }): string {
  if (typeof mod.PLACEHOLDER === 'string' && mod.PLACEHOLDER.length > 0) {
    return mod.PLACEHOLDER
  }
  if (typeof mod.referenceDraftText === 'function') {
    return mod.referenceDraftText(reference)
  }
  throw new Error('harness InputMachine 缺少 PLACEHOLDER / referenceDraftText，无法断言 chip 草稿形态')
}

function countSubstr(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count += 1
    from = at + needle.length
  }
  return count
}

/**
 * Integration against the real harness InputMachine.
 * Needs a local deepseek-harness checkout (ln -s ../deepseek-harness .) or DSH_HARNESS=.
 * Without it the suite is skipped so release/CI still pass.
 */
describe.skipIf(!hasHarnessMachine)('harness input machine accepts net-ref chips', () => {
  let InputMachine: InputMachineCtor
  let harnessMod: HarnessMachineMod

  beforeAll(async () => {
    harnessMod = await import(pathToFileURL(machinePath).href) as HarnessMachineMod
    InputMachine = harnessMod.InputMachine
  })

  it('mints an occurrence for a workbench-net reference at the cursor', () => {
    const machine = new InputMachine()
    machine.dispatch({ type: 'draft-changed', draft: 'hello world', editRange: { start: 0, end: 11 } })
    const before = machine.state
    const ref = buildNetReference({ method: 'POST', url: 'https://example.com/api' })
    expect(ref).not.toBeNull()
    machine.dispatch({
      type: 'insert-ref',
      reference: ref!,
      span: { start: 11, end: 11, draftRev: before.draftRev },
    })
    const after = machine.state
    expect(after.draft).toBe('hello world' + chipInDraft(harnessMod, ref!) + ' ')
    expect(after.occurrences.length).toBe(1)
    expect(after.occurrences[0]!.ref).toBe(encodeNetRef({ method: 'POST', url: 'https://example.com/api' }))
    expect(after.occurrences[0]!.label).toContain('curl')
    expect(after.draftRev).not.toBe(before.draftRev)
  })

  it('rejects a stale draftRev (span CAS)', () => {
    const machine = new InputMachine()
    machine.dispatch({ type: 'draft-changed', draft: 'abc', editRange: { start: 0, end: 3 } })
    const before = machine.state
    const ref = buildNetReference({ method: 'GET', url: 'https://example.com/x' })
    machine.dispatch({
      type: 'insert-ref',
      reference: ref!,
      span: { start: 3, end: 3, draftRev: before.draftRev + 999 },
    })
    expect(machine.state.draft).toBe('abc')
    expect(machine.state.occurrences.length).toBe(0)
  })

  it('keeps the capsule when a second reference is inserted (multi-chip drafts)', () => {
    const machine = new InputMachine()
    machine.dispatch({ type: 'draft-changed', draft: '', editRange: { start: 0, end: 0 } })
    const refA = buildNetReference({ method: 'GET', url: 'https://example.com/a' })
    machine.dispatch({
      type: 'insert-ref',
      reference: refA!,
      span: { start: 0, end: 0, draftRev: machine.state.draftRev },
    })
    const refB = buildNetReference({ method: 'POST', url: 'https://example.com/b' })
    const spanB = { start: machine.state.draft.length, end: machine.state.draft.length, draftRev: machine.state.draftRev }
    machine.dispatch({ type: 'insert-ref', reference: refB!, span: spanB })
    expect(machine.state.occurrences.length).toBe(2)
    const chipA = chipInDraft(harnessMod, refA!)
    const chipB = chipInDraft(harnessMod, refB!)
    if (chipA === chipB) {
      expect(countSubstr(machine.state.draft, chipA)).toBe(2)
    } else {
      expect(machine.state.draft).toContain(chipA)
      expect(machine.state.draft).toContain(chipB)
    }
  })
})
