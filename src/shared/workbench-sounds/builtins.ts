/**
 * Built-in sounds: 5 Web Audio synthesis presets.
 * These are compiled into the plugin — no audio files needed.
 * Each sound has a unique "feel" for different notification scenarios.
 */

export interface BuiltinSoundDef {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  /** Web Audio synthesis parameters */
  synth: {
    /** Note frequencies in Hz. Multiple notes play as an arpeggio or chord. */
    notes: number[]
    /** ms offset for each note's attack relative to the previous */
    delays: number[]
    /** Oscillator type: 'sine' | 'square' | 'sawtooth' | 'triangle' */
    waveform: OscillatorType
    /** Note duration in seconds */
    duration: number
    /** Peak gain (0-1) */
    volume: number
    /** ADSR attack time in seconds */
    attack: number
    /** ADSR decay time in seconds */
    decay: number
  }
}

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle'

/** 5 built-in notification sounds with distinctly different characters. */
export const BUILTIN_SOUNDS: BuiltinSoundDef[] = [
  {
    id: 'chime-ascending',
    name: 'Ascending Chime',
    nameZh: '上行琶音',
    description: 'Bright ascending arpeggio (A5→C#6→E6), cheerful and attention-getting',
    descriptionZh: '明亮的上行琶音（A5→C#6→E6），愉悦且引人注意',
    synth: {
      notes: [880, 1108.73, 1318.51],
      delays: [0, 90, 180],
      waveform: 'sine',
      duration: 0.25,
      volume: 0.16,
      attack: 0.01,
      decay: 0.22,
    },
  },
  {
    id: 'chime-double',
    name: 'Double Tone',
    nameZh: '双音',
    description: 'Soft double tone (G4→C5), gentle and unobtrusive',
    descriptionZh: '柔和的双音（G4→C5），温和不打扰',
    synth: {
      notes: [392, 523.25],
      delays: [0, 200],
      waveform: 'sine',
      duration: 0.4,
      volume: 0.12,
      attack: 0.02,
      decay: 0.35,
    },
  },
  {
    id: 'chime-attention',
    name: 'Attention',
    nameZh: 'Attention 音',
    description: 'Two sharp staccato tones (E5×2), slightly urgent',
    descriptionZh: '两个短促的 E5 音，稍有紧迫感',
    synth: {
      notes: [659.25, 659.25],
      delays: [0, 150],
      waveform: 'triangle',
      duration: 0.12,
      volume: 0.18,
      attack: 0.005,
      decay: 0.1,
    },
  },
  {
    id: 'chime-bell',
    name: 'Bell',
    nameZh: '铃音',
    description: 'Single bell-like tone (C6) with reverb-like decay',
    descriptionZh: '单音铃声（C6），有类似混响的衰减',
    synth: {
      notes: [1046.5],
      delays: [0],
      waveform: 'sine',
      duration: 0.6,
      volume: 0.14,
      attack: 0.003,
      decay: 0.55,
    },
  },
  {
    id: 'chime-minimal',
    name: 'Minimal',
    nameZh: '极简音',
    description: 'Single short blip (A4), barely there',
    descriptionZh: '单音短促 A4，几乎察觉不到',
    synth: {
      notes: [440],
      delays: [0],
      waveform: 'sine',
      duration: 0.08,
      volume: 0.1,
      attack: 0.005,
      decay: 0.07,
    },
  },
]

/** All built-in sound IDs for validation. */
export const BUILTIN_SOUND_IDS = BUILTIN_SOUNDS.map(s => s.id)
