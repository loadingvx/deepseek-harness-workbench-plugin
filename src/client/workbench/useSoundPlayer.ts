/**
 * useSoundPlayer — plays notification sounds using Web Audio API (built-in synthesis)
 * or HTMLAudioElement (custom audio files).
 *
 * Built-in sounds are Web Audio synthesis presets defined in shared/workbench-sounds/builtins.ts.
 * Custom sounds are served via HTTP from ~/.dsh/workbench-sounds/.
 */

import { useCallback, useRef, useState } from 'react'
import type { SoundEntry } from '../../shared/workbench-sounds/types.ts'
import { BUILTIN_SOUNDS, type BuiltinSoundDef } from '../../shared/workbench-sounds/builtins.ts'

const SOUNDS_HTTP_PREFIX = '/workbench-sounds'
const PREF_KEY = 'dsh-workbench-sound-id'

/** State for an AudioContext (browser only). */
interface AudioState {
  ac: AudioContext | null
  webkitAC: typeof AudioContext | null
}

function getAudioState(): AudioState {
  if (typeof window === 'undefined') return { ac: null, webkitAC: null }
  const webkitAC = (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAC
  return { ac: AC ?? null, webkitAC: webkitAC ?? null }
}

/** Play a built-in sound using Web Audio synthesis. */
function playBuiltin(sound: BuiltinSoundDef, stateRef: React.MutableRefObject<AudioState>): void {
  const { ac: AC } = stateRef.current
  if (AC === null) return

  let ac = stateRef.current.ac
  if (ac === null) {
    ac = new AC()
    stateRef.current.ac = ac
  }

  const resumeAndPlay = (): void => {
    const { synth } = sound
    const now = ac.currentTime

    synth.notes.forEach((freq, i) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()

      osc.type = synth.waveform
      osc.frequency.value = freq

      const startTime = now + (synth.delays[i] ?? 0) / 1000
      gain.gain.setValueAtTime(0.0001, startTime)
      gain.gain.exponentialRampToValueAtTime(synth.volume, startTime + synth.attack)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + synth.attack + synth.decay)

      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(startTime)
      osc.stop(startTime + synth.duration)
    })
  }

  if (ac.state === 'suspended') {
    ac.resume().then(resumeAndPlay).catch(() => {})
  } else {
    resumeAndPlay()
  }
}

/** Play a custom sound file via HTMLAudioElement. */
function playCustomUrl(url: string): void {
  const audio = new Audio(url)
  audio.volume = 0.8
  audio.play().catch(() => {})
}

export interface SoundPlayer {
  /** Play the currently selected sound. */
  play(): void
  /** Get the currently selected sound ID. */
  selectedId(): string
  /** Change the selected sound. */
  select(id: string): void
  /** Get all available sounds (builtins + custom). */
  allSounds(): SoundEntry[]
}

export interface UseSoundPlayerResult {
  player: SoundPlayer
  /** Reload the custom sounds list from the server. */
  refresh: () => Promise<void>
  /** Upload a File object as a new custom sound. Returns the new entry or error. */
  upload: (file: File) => Promise<{ ok: true; entry: SoundEntry } | { ok: false; message: string }>
  /** Delete a custom sound by ID. */
  remove: (id: string) => Promise<void>
}

export interface SoundEntry extends SoundEntry {
  /** URL to play this sound. For builtins it's 'builtin:{id}'. For custom it's the HTTP URL. */
  playUrl: string
}

/** Sound preference + all sounds list hook. */
export function useSoundPlayer(): UseSoundPlayerResult {
  const audioStateRef = useRef<AudioState>(getAudioState())
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(PREF_KEY) ?? 'chime-ascending' } catch { return 'chime-ascending' }
  })
  const [customSounds, setCustomSounds] = useState<SoundEntry[]>([])

  const savePref = useCallback((id: string) => {
    try { localStorage.setItem(PREF_KEY, id) } catch { /* ignore */ }
    setSelectedId(id)
  }, [])

  /** Fetch custom sounds from the server. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SOUNDS_HTTP_PREFIX}/`)
      if (!res.ok) return
      const data = await res.json() as { ok: boolean; index?: { custom: SoundEntry[] } }
      if (data.ok && data.index?.custom) {
        setCustomSounds(data.index.custom.map(e => ({
          ...e,
          playUrl: `${SOUNDS_HTTP_PREFIX}/${e.id}`,
        })))
      }
    } catch { /* ignore network errors */ }
  }, [])

  /** Upload a File as a new custom sound. */
  const upload = useCallback(async (file: File): Promise<{ ok: true; entry: SoundEntry } | { ok: false; message: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${SOUNDS_HTTP_PREFIX}/`, { method: 'POST', body: formData })
      const data = await res.json() as { ok: boolean; entry?: SoundEntry; message?: string }
      if (data.ok && data.entry) {
        const entry: SoundEntry = {
          ...data.entry,
          playUrl: `${SOUNDS_HTTP_PREFIX}/${data.entry.id}`,
        }
        setCustomSounds(prev => [...prev.filter(e => e.id !== entry.id), entry])
        return { ok: true, entry }
      }
      return { ok: false, message: data.message ?? 'Upload failed' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Network error' }
    }
  }, [])

  /** Delete a custom sound. */
  const remove = useCallback(async (id: string) => {
    try {
      await fetch(`${SOUNDS_HTTP_PREFIX}/${id}`, { method: 'DELETE' })
      setCustomSounds(prev => prev.filter(e => e.id !== id))
      // If deleted sound was selected, fall back to default
      if (selectedId === id) {
        savePref('chime-ascending')
      }
    } catch { /* ignore */ }
  }, [selectedId, savePref])

  /** Build the full sound list (builtins + custom). */
  const allSounds = useCallback((): SoundEntry[] => {
    const builtins: SoundEntry[] = BUILTIN_SOUNDS.map(s => ({
      id: s.id,
      name: s.name,
      nameZh: s.nameZh,
      kind: 'builtin' as const,
      url: `builtin:${s.id}`,
      playUrl: `builtin:${s.id}`,
      mimeType: 'audio/webaudio',
    }))
    return [...builtins, ...customSounds]
  }, [customSounds])

  const player: SoundPlayer = {
    play: useCallback(() => {
      if (selectedId.startsWith('builtin:') || BUILTIN_SOUNDS.some(s => s.id === selectedId)) {
        const builtin = BUILTIN_SOUNDS.find(s => s.id === selectedId) ?? BUILTIN_SOUNDS[0]
        playBuiltin(builtin, audioStateRef)
      } else {
        // Custom sound
        const custom = customSounds.find(e => e.id === selectedId)
        if (custom) {
          playCustomUrl(`${SOUNDS_HTTP_PREFIX}/${custom.id}`)
        }
      }
    }, [selectedId, customSounds]),

    selectedId: useCallback(() => selectedId, [selectedId]),

    select: useCallback((id: string) => {
      savePref(id)
    }, [savePref]),

    allSounds,
  }

  return { player, refresh, upload, remove }
}
