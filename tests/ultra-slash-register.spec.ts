import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { composeAliasText } from '../src/shared/ultra-slash/catalog.ts'
import { SKILL_COMMAND_NAME } from '../src/shared/ultra-slash/ids.ts'
import { translate } from '../src/shared/ultra-slash/locales.ts'
import { applyCommands, createCommandHub, loadHubFromDisk } from '../src/host/ultra-slash/register.ts'
import type { SteerAgent, SteerCommandDefinition, SteerInvocation } from '../src/shared/ultra-slash/types.ts'

function agent(status: SteerAgent['status'], steer: SteerAgent['steer'] = vi.fn()): SteerAgent {
  return { status, steer }
}

function invocation(
  rawInput: string,
  options: { status?: SteerAgent['status']; steer?: SteerAgent['steer'] } = {},
): { invocation: SteerInvocation; steer: SteerAgent['steer'] } {
  const steer = options.steer ?? vi.fn()
  return {
    steer,
    invocation: {
      agent: agent(options.status ?? 'running', steer),
      rawInput,
      signal: new AbortController().signal,
    },
  }
}

function mockCtx(registered: SteerCommandDefinition[] = []) {
  return {
    get() { return undefined },
    commands: {
      register(definition: SteerCommandDefinition) {
        if (registered.some((row) => row.name === definition.name)) {
          throw new Error(`command "${definition.name}" is already registered`)
        }
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
}

describe('applyCommands', () => {
  it('registers steer, new, skill, and docs', () => {
    const registered: SteerCommandDefinition[] = []
    applyCommands(mockCtx(registered))
    expect(registered.map((row) => row.name)).toEqual(['steer', 'new', 'skill', 'docs'])
  })

  it('injects the skill payload without calling cancel', () => {
    const registered: SteerCommandDefinition[] = []
    applyCommands(mockCtx(registered))
    const skill = registered.find((row) => row.name === SKILL_COMMAND_NAME)
    const { invocation: call, steer } = invocation('')
    const result = skill?.handler(call)
    expect(result?.kind).toBe('success')
    expect(steer).toHaveBeenCalledTimes(1)
    const message = vi.mocked(steer).mock.calls[0]?.[0]
    expect(message?.content[0]?.text).toBe(translate('zh', 'skill.payload'))
    expect(call.agent).not.toHaveProperty('cancel')
  })

  it('appends extra text after an alias payload', () => {
    const registered: SteerCommandDefinition[] = []
    applyCommands(mockCtx(registered))
    const docs = registered.find((row) => row.name === 'docs')
    const { invocation: call, steer } = invocation(' 重点写复现步骤 ')
    docs?.handler(call)
    expect(vi.mocked(steer).mock.calls[0]?.[0].content[0]?.text).toBe(
      composeAliasText(translate('zh', 'docs.payload'), '重点写复现步骤'),
    )
  })

  it('acknowledges /new without steering', () => {
    const registered: SteerCommandDefinition[] = []
    applyCommands(mockCtx(registered))
    const neu = registered.find((row) => row.name === 'new')
    const { invocation: call, steer } = invocation('')
    const result = neu?.handler(call)
    expect(result?.kind).toBe('success')
    expect(result?.text).toContain('空白会话')
    expect(steer).not.toHaveBeenCalled()
  })
})

describe('custom command hub', () => {
  it('registers, replaces, and persists aliases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-hub-'))
    const path = join(dir, 'commands.json')
    const registered: SteerCommandDefinition[] = []
    const ctx = mockCtx(registered)
    applyCommands(ctx)
    const hub = createCommandHub(ctx, path)
    const saved = await hub.saveCustom([{ name: 'review', steerText: '只看 diff' }])
    expect(saved.ok).toBe(true)
    expect(registered.some((row) => row.name === 'review')).toBe(true)

    const { invocation: call, steer } = invocation('再补一句')
    registered.find((row) => row.name === 'review')?.handler(call)
    expect(vi.mocked(steer).mock.calls[0]?.[0].content[0]?.text).toBe('只看 diff\n再补一句')

    const replaced = await hub.saveCustom([{ name: 'note', steerText: '只记结论' }])
    expect(replaced.ok).toBe(true)
    expect(registered.some((row) => row.name === 'review')).toBe(false)
    expect(registered.some((row) => row.name === 'note')).toBe(true)

    const reloaded = mockCtx()
    applyCommands(reloaded)
    const hub2 = createCommandHub(reloaded, path)
    const loaded = await loadHubFromDisk(hub2, path)
    expect(loaded.ok).toBe(true)
    expect(hub2.listCustom().map((row) => row.name)).toEqual(['note'])
  })

  it('rejects a reserved name without touching live commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultra-slash-hub-'))
    const registered: SteerCommandDefinition[] = []
    const hub = createCommandHub(mockCtx(registered), join(dir, 'commands.json'))
    const result = await hub.saveCustom([{ name: 'steer', steerText: 'x' }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('/steer')
    expect(hub.listCustom()).toEqual([])
  })
})
