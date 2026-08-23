// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_SOUNDS } from '../src/shared/workbench-sounds/builtins.ts'

let resumeOk = true
let created = 0
let starts = 0

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  destination = {} as AudioDestinationNode

  constructor() {
    created += 1
  }

  resume(): Promise<void> {
    if (!resumeOk) return Promise.reject(new Error('blocked by autoplay policy'))
    return Promise.resolve().then(() => {
      this.state = 'running'
    })
  }

  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }

  createOscillator(): OscillatorNode {
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect() { return this as unknown as AudioNode },
      start() { starts += 1 },
      stop() {},
    } as unknown as OscillatorNode
  }

  createGain(): GainNode {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() { return this as unknown as AudioNode },
    } as unknown as GainNode
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  resumeOk = true
  created = 0
  starts = 0
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(async () => {
  const audio = await import('../src/client/workbench/useSessionMonitor.ts')
  audio.resetSharedBeepAudio()
  vi.unstubAllGlobals()
  try { localStorage.removeItem('dsh-workbench-sound-id') } catch { /* ignore */ }
})

describe('shared AudioContext beep', () => {
  it('reuses one AudioContext across many plays (loop reminder must not hit the ~6 cap)', async () => {
    const { playBuiltinSound } = await import('../src/client/workbench/useSessionMonitor.ts')
    const sound = BUILTIN_SOUNDS[0]!
    playBuiltinSound(sound)
    await flush()
    for (let i = 0; i < 19; i++) playBuiltinSound(sound)
    await flush()
    expect(created).toBe(1)
    expect(starts).toBe(sound.synth.notes.length * 20)
  })

  it('keeps a pending beep when resume is blocked, then plays after a user gesture', async () => {
    resumeOk = false
    const { playBuiltinSound } = await import('../src/client/workbench/useSessionMonitor.ts')
    playBuiltinSound(BUILTIN_SOUNDS[0]!)
    await flush()
    expect(created).toBe(1)
    expect(starts).toBe(0)

    resumeOk = true
    window.dispatchEvent(new Event('pointerdown'))
    await flush()
    expect(created).toBe(1)
    expect(starts).toBe(BUILTIN_SOUNDS[0]!.synth.notes.length)
  })

  it('recreates the shared context if the previous one was closed', async () => {
    const { playBuiltinSound, getSharedBeepAudioContext } = await import('../src/client/workbench/useSessionMonitor.ts')
    playBuiltinSound(BUILTIN_SOUNDS[0]!)
    await flush()
    expect(created).toBe(1)
    await getSharedBeepAudioContext()?.close()
    playBuiltinSound(BUILTIN_SOUNDS[0]!)
    await flush()
    expect(created).toBe(2)
    expect(starts).toBe(BUILTIN_SOUNDS[0]!.synth.notes.length * 2)
  })

  it('playWorkbenchSound uses the selected builtin without allocating a fresh context each call', async () => {
    localStorage.setItem('dsh-workbench-sound-id', 'chime-double')
    const { playWorkbenchSound } = await import('../src/client/workbench/useSessionMonitor.ts')
    playWorkbenchSound()
    await flush()
    playWorkbenchSound()
    await flush()
    expect(created).toBe(1)
    const double = BUILTIN_SOUNDS.find(s => s.id === 'chime-double')!
    expect(starts).toBe(double.synth.notes.length * 2)
  })

  it('Workbench wires the shared player and does not new AudioContext per ring', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/client/workbench/Workbench.tsx'), 'utf8')
    expect(src).toContain('playWorkbenchSound')
    expect(src).not.toMatch(/acRef\s*=\s*\{\s*ac:\s*null/)
    expect(src).not.toContain('new AudioContext')
  })
})
