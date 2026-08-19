import { describe, expect, it } from 'vitest'
import { InputMachine } from '/root/arch_workspace/deepseek-harness/packages/client/ui-conversation/src/client/input/machine.ts'
import { buildNetReference, encodeNetRef } from '../src/shared/browser-net-ref.ts'

const PLACEHOLDER = '\uFFFC'

describe('harness input machine accepts net-ref chips', () => {
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
    expect(after.draft).toBe('hello world' + PLACEHOLDER + ' ')
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
    expect(machine.state.draft).toContain('\uFFFC')
  })
})
