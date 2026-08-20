import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeAliasText,
  MAX_CUSTOM_COMMANDS,
  normalizeCommandName,
  normalizeDefaults,
  validateCustomCommand,
  validateCustomList,
} from '../src/shared/ultra-slash/catalog.ts'
import { formatCatalogIssue } from '../src/shared/ultra-slash/locales.ts'
import {
  customCommandStorePath,
  loadBuiltinDefaults,
  loadCustomCommands,
  loadUltraSlashStore,
  saveCustomCommands,
  StoreError,
} from '../src/host/ultra-slash/store.ts'

describe('normalizeCommandName', () => {
  it('strips a leading slash and lowercases', () => {
    expect(normalizeCommandName(' /Review ')).toBe('review')
    expect(normalizeCommandName('save-note')).toBe('save-note')
  })
})

describe('validateCustomCommand', () => {
  it('accepts a well-formed alias', () => {
    const result = validateCustomCommand({
      name: 'Review',
      description: ' 查 diff ',
      steerText: '  完成后只看 diff  ',
    })
    expect(result).toEqual({
      ok: true,
      command: { name: 'review', description: '查 diff', steerText: '完成后只看 diff' },
    })
  })

  it('fills description from the payload when it is omitted', () => {
    const result = validateCustomCommand({ name: 'note', steerText: '只记结论' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.command.description).toBe('只记结论')
  })

  it('rejects empty, invalid, reserved, taken, and empty payload names', () => {
    expect(validateCustomCommand({ name: '', steerText: 'x' }).ok).toBe(false)
    expect(validateCustomCommand({ name: '中文', steerText: 'x' }).ok).toBe(false)
    expect(validateCustomCommand({ name: 'steer', steerText: 'x' }).ok).toBe(false)
    expect(validateCustomCommand({ name: 'plan', steerText: 'x' }).ok).toBe(false)
    expect(validateCustomCommand({ name: 'review', steerText: 'x' }, new Set(['review'])).ok).toBe(false)
    expect(validateCustomCommand({ name: 'review', steerText: '   ' }).ok).toBe(false)
  })

  it('explains reserved names in chinese', () => {
    const result = validateCustomCommand({ name: 'skill', steerText: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(formatCatalogIssue('zh', result.issue)).toContain('/skill')
      expect(formatCatalogIssue('zh', result.issue)).toContain('换一个')
    }
  })
})

describe('validateCustomList', () => {
  it('rejects a duplicate name in one save', () => {
    const result = validateCustomList([
      { name: 'one', steerText: 'a' },
      { name: 'one', steerText: 'b' },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issue).toEqual({ code: 'list.duplicate', name: 'one' })
  })

  it('rejects more than the cap', () => {
    const rows = Array.from({ length: MAX_CUSTOM_COMMANDS + 1 }, (_, index) => ({
      name: `c${index}`,
      steerText: 'x',
    }))
    const result = validateCustomList(rows)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issue.code).toBe('tooMany')
  })
})

describe('normalizeDefaults', () => {
  it('keeps only configurable names, trims, and drops empties', () => {
    expect(normalizeDefaults({ new: '  第一句话  ', skill: '   ', docs: '写文档', steer: 'x', unknown: 'y' }))
      .toEqual({ new: '第一句话', docs: '写文档' })
  })

  it('treats missing and non-object input as empty', () => {
    expect(normalizeDefaults(undefined)).toEqual({})
    expect(normalizeDefaults(null as unknown as Record<string, unknown>)).toEqual({})
    expect(normalizeDefaults({ new: 42 })).toEqual({})
  })

  it('caps each value at the steer text limit', () => {
    const long = '字'.repeat(10000)
    const out = normalizeDefaults({ skill: long })
    expect(out.skill?.length).toBe(8000)
  })
})

describe('composeAliasText', () => {
  it('keeps the template when the suffix is empty', () => {
    expect(composeAliasText('固定内容', '  ')).toBe('固定内容')
  })

  it('appends extra guidance on a new line', () => {
    expect(composeAliasText('固定内容', ' 再补一句 ')).toBe('固定内容\n再补一句')
  })
})

describe('custom command store', () => {
  it('round-trips a list and treats a missing file as empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-'))
    const path = join(dir, 'commands.json')
    expect(await loadCustomCommands(path)).toEqual([])
    await saveCustomCommands(path, [{ name: 'review', description: '查', steerText: '只看 diff' }])
    expect(await loadCustomCommands(path)).toEqual([
      { name: 'review', description: '查', steerText: '只看 diff' },
    ])
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('"version": 1')
  })

  it('refuses to parse a corrupt file so a later save cannot wipe it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-'))
    const path = join(dir, 'commands.json')
    await writeFile(path, '{not json', 'utf8')
    await expect(loadCustomCommands(path)).rejects.toBeInstanceOf(StoreError)
  })

  it('places the store under DSH_HOME', () => {
    expect(customCommandStorePath({ DSH_HOME: '/tmp/dsh-home' })).toBe(
      '/tmp/dsh-home/ultra-slash/commands.json',
    )
  })

  it('round-trips builtin defaults together with the custom list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-defaults-'))
    const path = join(dir, 'commands.json')
    await saveCustomCommands(path, [{ name: 'review', steerText: '只看 diff' }], { new: '先总结改动', docs: '写 md' })
    expect(await loadBuiltinDefaults(path)).toEqual({ new: '先总结改动', docs: '写 md' })
    const whole = await loadUltraSlashStore(path)
    expect(whole.commands).toEqual([{ name: 'review', description: '只看 diff', steerText: '只看 diff' }])
    expect(whole.defaults).toEqual({ new: '先总结改动', docs: '写 md' })
  })

  it('omits the defaults field when there is nothing configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-defaults-'))
    const path = join(dir, 'commands.json')
    await saveCustomCommands(path, [])
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('"defaults"')
    expect(await loadBuiltinDefaults(path)).toEqual({})
  })

  it('normalizes a corrupt defaults section without wiping the commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-defaults-'))
    const path = join(dir, 'commands.json')
    await writeFile(
      path,
      JSON.stringify({ version: 1, commands: [{ name: 'review', steerText: 'x' }], defaults: { new: 5, skill: 'ok' } }),
      'utf8',
    )
    const whole = await loadUltraSlashStore(path)
    expect(whole.commands.map((row) => row.name)).toEqual(['review'])
    expect(whole.defaults).toEqual({ skill: 'ok' })
  })
})
