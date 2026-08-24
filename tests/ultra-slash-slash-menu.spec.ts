import { describe, expect, it, vi } from 'vitest'
import { COMMAND_NAME, PLUGIN_NAME } from '../src/shared/ultra-slash/ids.ts'
import { en, translate, zh } from '../src/shared/ultra-slash/locales.ts'
import {
  filterPluginCommands,
  findCommandSource,
  hidePluginNamesFromCommandSource,
  installCommandSourceFilter,
  patchSlashMenuGroupTitle,
  PLUGIN_SLASH_COMMANDS,
  PLUGIN_SLASH_DIVIDER_CSS,
  PLUGIN_SLASH_NAMES,
  PLUGIN_SLASH_ORDER,
  PLUGIN_SLASH_SOURCE,
  pluginLexicon,
  pluginSlashCandidates,
  SLASH_MENU_TITLE_EN,
  SLASH_MENU_TITLE_ZH,
  type LocaleRegistry,
  type SlashSource,
  type SlashTriggerService,
} from '../src/client/ultra-slash/slash-menu.ts'

function commandSource(
  rows: Array<{ name: string; description?: string }>,
): SlashSource {
  return {
    trigger: '/',
    name: 'command',
    candidates: async () => rows,
    onPick: vi.fn(),
  }
}

describe('plugin slash catalog', () => {
  it('keeps the ultra-slash group identity after merging into workbench', () => {
    expect(PLUGIN_NAME).toBe('deepseek-harness-ultra-slash')
    expect(PLUGIN_SLASH_SOURCE).toBe('ultra-slash')
    expect(PLUGIN_SLASH_ORDER).toBeGreaterThan(2)
    expect(PLUGIN_SLASH_DIVIDER_CSS).toContain(`[data-source="${PLUGIN_SLASH_SOURCE}"]`)
    expect(PLUGIN_SLASH_DIVIDER_CSS).toContain('[role="presentation"][data-source] ~')
    expect(PLUGIN_SLASH_DIVIDER_CSS).not.toContain(`[data-source="${PLUGIN_SLASH_SOURCE}"] ~ [data-source="command"]`)
  })

  it('lists shipped commands with locale keys, not a hardcoded language', () => {
    expect(PLUGIN_SLASH_COMMANDS.map((row) => row.name)).toEqual(['steer', 'new', 'skill', 'docs', 'canvas'])
    expect(PLUGIN_SLASH_COMMANDS[0]).toEqual({
      name: COMMAND_NAME,
      descriptionKey: 'steer.description',
      hintKey: 'steer.hint',
    })
    expect(PLUGIN_SLASH_NAMES.has('steer')).toBe(true)
    expect(PLUGIN_SLASH_NAMES.has('new')).toBe(true)
  })

  it('derives the text-ref lexicon from builtin plus custom names', () => {
    expect(pluginLexicon()).toEqual(['steer', 'new', 'skill', 'docs', 'canvas'])
    expect(pluginLexicon(['review', 'note'])).toEqual(['steer', 'new', 'skill', 'docs', 'canvas', 'review', 'note'])
    expect(pluginLexicon(['steer'])).toEqual(['steer', 'new', 'skill', 'docs', 'canvas'])
  })

  it('keeps catalog order when the query is empty', () => {
    const extra = [
      ...PLUGIN_SLASH_COMMANDS,
      { name: 'zzz', descriptionKey: 'steer.description' as const, hintKey: 'steer.hint' as const },
      { name: 'aaa', descriptionKey: 'steer.description' as const, hintKey: 'steer.hint' as const },
    ]
    expect(filterPluginCommands(extra, '').map((row) => row.name)).toEqual([
      'steer',
      'new',
      'skill',
      'docs',
      'canvas',
      'zzz',
      'aaa',
    ])
  })

  it('ranks prefix matches ahead of substring matches without DSH fuzzy scores', () => {
    const commands = [
      { name: 'help', description: 'a', hint: '' },
      { name: 'steer', description: 'b', hint: '' },
      { name: 'status', description: 'c', hint: '' },
    ]
    expect(filterPluginCommands(commands, 'st').map((row) => row.name)).toEqual([
      'steer',
      'status',
    ])
    expect(filterPluginCommands(commands, 'eer').map((row) => row.name)).toEqual([
      'steer',
    ])
    expect(filterPluginCommands(commands, 'xyz')).toEqual([])
  })

  it('hides hinted commands from the inline `/` position', () => {
    expect(pluginSlashCandidates('', false)).toEqual([])
    expect(pluginSlashCandidates('st', true)).toEqual([
      {
        name: 'steer',
        description: zh['steer.description'],
        hint: zh['steer.hint'],
      },
    ])
    expect(pluginSlashCandidates('st', true, (key) => translate('en', key as keyof typeof en))).toEqual([
      {
        name: 'steer',
        description: en['steer.description'],
        hint: en['steer.hint'],
      },
    ])
    expect(en['steer.description']).not.toMatch(/[\u4e00-\u9fff]/)
    expect(zh['steer.description']).toMatch(/[\u4e00-\u9fff]/)
    expect(pluginSlashCandidates('', true, undefined, [
      { name: 'review', description: '查 diff', steerText: '只看 diff' },
    ]).map((row) => row.name)).toEqual(['steer', 'new', 'skill', 'docs', 'canvas', 'review'])
  })
})

describe('built-in command source filter', () => {
  it('drops plugin names from the 命令 group and restores on dispose', async () => {
    const source = commandSource([
      { name: 'help' },
      { name: 'steer' },
      { name: 'plan' },
    ])
    const restore = hidePluginNamesFromCommandSource(source)
    expect((await source.candidates({}, { query: '', position: 'leading', signal: new AbortController().signal })).map((row) => row.name)).toEqual([
      'help',
      'plan',
    ])
    restore()
    expect((await source.candidates({}, { query: '', position: 'leading', signal: new AbortController().signal })).map((row) => row.name)).toEqual([
      'help',
      'steer',
      'plan',
    ])
  })

  it('does not wrap a non-command source', async () => {
    const source: SlashSource = {
      trigger: '/',
      name: PLUGIN_SLASH_SOURCE,
      candidates: async () => [{ name: 'steer' }],
      onPick: vi.fn(),
    }
    const restore = hidePluginNamesFromCommandSource(source)
    expect((await source.candidates({}, { query: '', position: 'leading', signal: new AbortController().signal })).map((row) => row.name)).toEqual([
      'steer',
    ])
    restore()
  })

  it('wraps a command source that registers after the filter is installed', async () => {
    const live: { sources: SlashSource[] } = { sources: [] }
    const service: SlashTriggerService = {
      live,
      registerSource(src) {
        live.sources.push(src)
        return () => {
          const at = live.sources.indexOf(src)
          if (at >= 0) live.sources.splice(at, 1)
        }
      },
    }
    const stop = installCommandSourceFilter(service)
    const source = commandSource([{ name: 'help' }, { name: 'steer' }])
    service.registerSource(source)
    expect((await source.candidates({}, { query: '', position: 'leading', signal: new AbortController().signal })).map((row) => row.name)).toEqual([
      'help',
    ])
    expect(findCommandSource(service)).toBe(source)
    stop()
    expect((await source.candidates({}, { query: '', position: 'leading', signal: new AbortController().signal })).map((row) => row.name)).toEqual([
      'help',
      'steer',
    ])
  })
})

describe('slash.menu group title', () => {
  it('writes bilingual titles onto the existing slash.menu dictionaries', () => {
    const zh: Record<string, string> = { command: '命令' }
    const en: Record<string, string> = { command: 'Commands' }
    const dicts = new Map<string, Map<string, Record<string, string>>>([
      ['slash.menu', new Map([['zh', zh], ['en', en]])],
    ])
    const locale: LocaleRegistry = {
      dicts,
      register: vi.fn(),
    }
    const restore = patchSlashMenuGroupTitle(locale)
    expect(zh[PLUGIN_SLASH_SOURCE]).toBe(SLASH_MENU_TITLE_ZH)
    expect(en[PLUGIN_SLASH_SOURCE]).toBe(SLASH_MENU_TITLE_EN)
    restore()
    expect(zh[PLUGIN_SLASH_SOURCE]).toBeUndefined()
    expect(en[PLUGIN_SLASH_SOURCE]).toBeUndefined()
  })

  it('patches again when slash.menu registers late', () => {
    const dicts = new Map<string, Map<string, Record<string, string>>>()
    const locale: LocaleRegistry = {
      dicts,
      register(ns: string) {
        if (ns === 'slash.menu') {
          dicts.set('slash.menu', new Map([
            ['zh', { command: '命令' }],
            ['en', { command: 'Commands' }],
          ]))
        }
        return () => {}
      },
    }
    const restore = patchSlashMenuGroupTitle(locale)
    locale.register('slash.menu', { zh: {}, en: {} })
    expect(dicts.get('slash.menu')?.get('zh')?.[PLUGIN_SLASH_SOURCE]).toBe(SLASH_MENU_TITLE_ZH)
    restore()
  })
})

describe('conflict yield on the client half', () => {
  it('slashSourceTaken detects a pre-registered /ultra-slash source', async () => {
    const { slashSourceTaken } = await import('../src/client/ultra-slash/install.ts')
    const service: SlashTriggerService = {
      live: {
        sources: [
          { trigger: '/', name: 'ultra-slash', candidates: async () => [], onPick: vi.fn() },
        ],
      },
      registerSource: vi.fn(() => () => {}),
    }
    expect(slashSourceTaken(service)).toBe(true)
    const empty: SlashTriggerService = { live: { sources: [] }, registerSource: vi.fn(() => () => {}) }
    expect(slashSourceTaken(empty)).toBe(false)
  })

  it('installUltraSlashClient stands down when the /ultra-slash source is already owned', async () => {
    const { installUltraSlashClient } = await import('../src/client/ultra-slash/install.ts')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registerSource = vi.fn(() => () => {})
    const service: SlashTriggerService = {
      live: {
        sources: [
          { trigger: '/', name: 'ultra-slash', candidates: async () => [], onPick: vi.fn() },
        ],
      },
      registerSource,
    }
    const effects: Array<() => unknown> = []
    const ctx = {
      effect(fn: () => unknown) {
        effects.push(fn)
        return () => {}
      },
      get: () => undefined,
      inputTriggers: service,
      locale: {
        dicts: new Map(),
        register: vi.fn(() => () => {}),
        getSnapshot: () => ({ active: 'zh' }),
      },
    }
    installUltraSlashClient(ctx as never)
    for (const fn of effects) fn()
    expect(registerSource).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stands down'))
    warn.mockRestore()
  })
})
