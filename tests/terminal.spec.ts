import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { clampSize, pickShell, termColorEnv, TerminalHub, type PtyHandle } from '../src/host/terminal.ts'

function fakePty() {
  const written: string[] = []
  const data = new EventEmitter()
  const exit = new EventEmitter()
  let size = { cols: 80, rows: 24 }
  const pty: PtyHandle = {
    write: (chunk) => { written.push(chunk) },
    resize: (cols, rows) => { size = { cols, rows } },
    kill: () => { exit.emit('exit', { exitCode: 0 }) },
    onData: (handler) => {
      data.on('data', handler)
      return { dispose: () => { data.off('data', handler) } }
    },
    onExit: (handler) => {
      exit.on('exit', handler)
      return { dispose: () => { exit.off('exit', handler) } }
    },
  }
  return {
    pty,
    written,
    size: () => size,
    emitData: (chunk: string) => { data.emit('data', chunk) },
  }
}

describe('pickShell', () => {
  it('accepts a normal SHELL path and rejects a sneaky one', async () => {
    expect(await pickShell({ SHELL: '/bin/bash' }, async () => true)).toBe('/bin/bash')
    expect(await pickShell({ SHELL: '/tmp/evil' }, async (abs) => abs === '/bin/sh')).toBe('/bin/sh')
    await expect(pickShell({ SHELL: '/tmp/evil' }, async () => false)).rejects.toMatchObject({ code: 'TERM_NO_SHELL' })
  })
})

describe('clampSize', () => {
  it('keeps a normal size and falls back on garbage', () => {
    expect(clampSize(120, 10, 400, 80)).toBe(120)
    expect(clampSize(Number.NaN, 10, 400, 80)).toBe(80)
    expect(clampSize(2, 10, 400, 80)).toBe(10)
    expect(clampSize(9999, 10, 400, 80)).toBe(400)
  })
})

describe('TerminalHub', () => {
  it('writes into the workspace PTY and redacts token-like output', async () => {
    const fake = fakePty()
    const hub = new TerminalHub({
      exists: async () => true,
      env: { SHELL: '/bin/bash' },
      spawnPty: async () => fake.pty,
    })
    const chunks: string[] = []
    const res = {
      writeHead: () => undefined,
      write: (line: string) => {
        const match = line.match(/^data: (.*)\n\n$/)
        if (match?.[1] !== undefined) {
          const event = JSON.parse(match[1]) as { type: string; text?: string }
          if (event.type === 'out' && event.text !== undefined) chunks.push(event.text)
        }
        return true
      },
      on: () => undefined,
    }
    await hub.attach('ws1', '/repo', res as never)
    await hub.write('ws1', '/repo', 'echo hi\n')
    expect(fake.written).toEqual(['echo hi\n'])
    fake.emitData('token ghp_abcdefghijklmnopqrstuv done\n')
    expect(chunks.join('')).toContain('ghp_abc***uv')
    expect(chunks.join('')).not.toContain('ghp_abcdefghijklmnopqrstuv')
    hub.disposeAll()
  })

  it('rejects an oversized write', async () => {
    const fake = fakePty()
    const hub = new TerminalHub({
      exists: async () => true,
      env: { SHELL: '/bin/bash' },
      spawnPty: async () => fake.pty,
    })
    await expect(hub.write('ws1', '/repo', 'x'.repeat(300_000))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    hub.disposeAll()
  })

  it('keeps two terminal tabs on the same workspace apart', async () => {
    const one = fakePty()
    const two = fakePty()
    let spawnCount = 0
    const hub = new TerminalHub({
      exists: async () => true,
      env: { SHELL: '/bin/bash' },
      spawnPty: async () => {
        spawnCount += 1
        return spawnCount === 1 ? one.pty : two.pty
      },
    })
    await hub.write('ws1', '/repo', 'first\n', 80, 24, 'main')
    await hub.write('ws1', '/repo', 'second\n', 80, 24, '2')
    expect(one.written).toEqual(['first\n'])
    expect(two.written).toEqual(['second\n'])
    await hub.close('ws1', '2')
    hub.disposeAll()
  })

  it('resizes the live PTY', async () => {
    const fake = fakePty()
    const hub = new TerminalHub({
      exists: async () => true,
      env: { SHELL: '/bin/bash' },
      spawnPty: async () => fake.pty,
    })
    await hub.write('ws1', '/repo', 'a')
    const result = await hub.resize('ws1', '/repo', 132, 40)
    expect(result).toEqual({ ok: true, cols: 132, rows: 40 })
    expect(fake.size()).toEqual({ cols: 132, rows: 40 })
    hub.disposeAll()
  })

  it('keeps the live stream attached after reconnect', async () => {
    const first = fakePty()
    const second = fakePty()
    let spawnCount = 0
    const hub = new TerminalHub({
      exists: async () => true,
      env: { SHELL: '/bin/bash' },
      spawnPty: async () => {
        spawnCount += 1
        return spawnCount === 1 ? first.pty : second.pty
      },
    })
    const chunks: string[] = []
    const res = {
      writeHead: () => undefined,
      write: (line: string) => {
        const match = line.match(/^data: (.*)\n\n$/)
        if (match?.[1] !== undefined) {
          const event = JSON.parse(match[1]) as { type: string; text?: string }
          if (event.type === 'out' && event.text !== undefined) chunks.push(event.text)
          if (event.type === 'exit') chunks.push('EXIT')
        }
        return true
      },
      on: () => undefined,
    }
    await hub.attach('ws1', '/repo', res as never)
    await hub.restart('ws1', '/repo')
    second.emitData('after-restart\n')
    expect(chunks.join('')).toContain('after-restart')
    expect(chunks.join('')).not.toContain('EXIT')
    hub.disposeAll()
  })
})

describe('termColorEnv', () => {
  it('sets a real xterm TERM for the PTY child', () => {
    const env = termColorEnv({ PATH: '/bin' }, '/repo')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PWD).toBe('/repo')
  })
})
