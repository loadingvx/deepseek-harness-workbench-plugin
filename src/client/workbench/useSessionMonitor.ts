/**
 * 全局会话监控 · React 接线层（hook）
 *
 * - useAttentionCounts：标签角标计数（窄选择器，数字订阅，仅计数变化时重渲染）；
 * - useAckVersion：已读记认版本订阅（面板读取共享 ack）；
 * - useBeepOn：提示音开关（面板 🔔 与工作台提示音效果共享）；
 * - useLoopReminder / useReminderInterval：循环提醒开关与间隔（localStorage 持久化偏好）；
 * - useSessionBeep：有待注意项时播放提示音（从无到有播放 1 次，清空后重置；
 *   循环提醒开启时每隔 N 秒重播，直到处理完或关闭）。
 *
 * 提示音播放：Web Audio API（内置合成）；用户自定义音频（ogg/mp3/wav/webm/m4a/flac）
 * 经 HTMLAudioElement 播放。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getLoopReminder,
  getReminderInterval,
  setLoopReminder,
  setReminderInterval,
  subscribeLoopReminder,
  subscribeReminderInterval,
} from './reminder-settings.ts'
import {
  ackSnapshot,
  countAttention,
  countRunning,
  getAckVersion,
  getBeepOn,
  setBeepOn,
  subscribeAck,
  subscribeBeep,
  type SessionListLike,
  type WorkspaceListLike,
} from './session-monitor.ts'
import { BUILTIN_SOUNDS, type BuiltinSoundDef } from '../../shared/workbench-sounds/builtins.ts'

export type SessionSelectorHook = (selector: (state: SessionListLike) => unknown) => unknown
export type WorkspaceSelectorHook = (selector: (state: WorkspaceListLike) => unknown) => unknown

export interface AttentionCounts {
  attention: number
  running: number
}

export function useAttentionCounts(
  useSessions: SessionSelectorHook,
  useWorkspaces: WorkspaceSelectorHook,
): AttentionCounts {
  const ackVersion = useSyncExternalStore(subscribeAck, getAckVersion, getAckVersion)
  // 归档集数组引用在未变化时保持稳定（workspaces 快照按 Object.is 比对选择器结果），
  // 故该订阅只在归档集合真正变化时触发重渲染。
  const archivedIds = useWorkspaces((state) => (state as WorkspaceListLike).archivedSessionIds) as
    | string[]
    | undefined
  const archived = useMemo(() => {
    const ids = archivedIds ?? []
    return ids.length === 0 ? undefined : new Set(ids)
  }, [archivedIds])
  const attention = useSessions((state) => countAttention(state, ackSnapshot(), archived)) as number
  const running = useSessions((state) => countRunning(state, archived)) as number
  void ackVersion
  return { attention, running }
}

export function useAckVersion(): number {
  return useSyncExternalStore(subscribeAck, getAckVersion, getAckVersion)
}

export function useBeepOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getBeepOn)
  useEffect(() => subscribeBeep(setOn), [])
  return [on, setBeepOn]
}

/** 循环提醒开关（偏好持久化；面板 ⏰ 与工作台循环定时器共享）。 */
export function useLoopReminder(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getLoopReminder)
  useEffect(() => subscribeLoopReminder(setOn), [])
  return [on, setLoopReminder]
}

/** 循环提醒间隔（秒，5–3600，偏好持久化）。 */
export function useReminderInterval(): [number, (sec: number) => void] {
  const [sec, setSec] = useState(getReminderInterval)
  useEffect(() => subscribeReminderInterval(setSec), [])
  return [sec, setSec]
}

export interface BeepState {
  last: number
  had: boolean
  ac: AudioContext | null
}

/** Get AudioContext constructor (browser only, with webkit prefix fallback). */
function getAudioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const webkitAC = (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return (typeof AudioContext !== 'undefined' ? AudioContext : webkitAC) ?? null
}

/**
 * Play a built-in sound using Web Audio synthesis.
 * @param sound - The built-in sound definition
 * @param stateRef - Ref to AudioContext state (reused across calls)
 */
export function playBuiltinSound(sound: BuiltinSoundDef, stateRef: React.MutableRefObject<{ ac: AudioContext | null }>): void {
  const AC = getAudioCtor()
  if (!AC) return

  try {
    if (stateRef.current.ac === null) {
      stateRef.current.ac = new AC()
    }
    const ac = stateRef.current.ac

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
      ac.resume().then(resumeAndPlay).catch(() => { /* 音频被策略阻止：静默降级 */ })
    } else {
      resumeAndPlay()
    }
  } catch { /* 音频不可用：静默降级，不影响监控面板本体 */ }
}

/**
 * 当前正在播放的自定义音频元素（模块级持有，防止：
 * ① 局部变量被 GC 中途回收导致播放被截断；
 * ② 循环提醒/快速重触发时多个元素叠加出声）。
 */
let currentAudio: HTMLAudioElement | null = null

/**
 * Play a custom sound file via HTMLAudioElement.
 * @param url - URL to the audio file (HTTP or data URL)
 */
export function playCustomSound(url: string): void {
  try {
    // 替换上一次播放实例：先停旧播放并清空 src，再播新的
    if (currentAudio !== null) {
      currentAudio.pause()
      currentAudio.src = ''
      currentAudio = null
    }
    const audio = new Audio(url)
    audio.volume = 0.8
    currentAudio = audio
    audio.play().catch(() => { /* 播放被浏览器策略拒绝：静默降级 */ })
  } catch { /* 静默降级 */ }
}

/**
 * 提示音效果（挂在始终挂载的 WorkbenchInner，面板未打开也生效）：
 * ① 一次提示：开关开启且有注意项时，从无到有播放 1 次；注意项清空或开关关闭即重置。
 * ② 循环提醒：开关开启且循环提醒开启且有未处理注意项时，每隔 N 秒重播一次提示音，
 *    直到处理完或关闭；浏览器会节流后台标签页的 setInterval，故回到前台时补播一次。
 *
 * @param attention - Current attention count
 * @param playSound - Callback to play the currently selected sound
 */
export function useSessionBeep(
  attention: number,
  playSound: () => void,
): void {
  const [beepOn] = useBeepOn()
  const [loopReminder] = useLoopReminder()
  const [intervalSec] = useReminderInterval()

  useEffect(() => {
    if (!beepOn || attention === 0) {
      return
    }
    // Play once on first appearance
    playSound()
  }, [attention, beepOn, playSound])

  useEffect(() => {
    if (!beepOn || !loopReminder || attention === 0) return
    const intervalMs = Math.max(1000, Math.round(intervalSec * 1000))
    const tick = (): void => { playSound() }
    const id = window.setInterval(tick, intervalMs)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [beepOn, loopReminder, intervalSec, attention, playSound])
}

// Re-export for backward compatibility
export { playBuiltinSound as playChime }

/** Get all built-in sounds. */
export function getBuiltinSounds(): BuiltinSoundDef[] {
  return BUILTIN_SOUNDS
}
