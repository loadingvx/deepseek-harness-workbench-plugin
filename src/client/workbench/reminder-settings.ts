/**
 * 循环提醒偏好（页面级配置，localStorage 持久化，刷新不丢）。
 *
 * 提示音开关（session-monitor.ts 的 beep store）是页面会话期内存态，只管「发声与否」；
 * 这里的循环提醒开关与间隔是「配置」——开启后，只要还有未处理的注意项
 * （未读完成 / 等待审批 / 方案确认 / 提问），每隔 N 秒重播一次提示音，
 * 直到处理完或关闭。间隔范围 5–3600 秒，默认 10 秒。
 */
import { readBoolFlag, writeBoolFlag } from './ui-flags.ts'

export const LOOP_REMINDER_KEY = 'dsh-workbench-loop-reminder'
export const REMINDER_INTERVAL_KEY = 'dsh-workbench-reminder-interval'

/** 出厂默认：循环提醒开启、间隔 10 秒（与旧 session-orb 的每 10 秒重播一致）。 */
export const DEFAULT_LOOP_REMINDER = true
export const DEFAULT_REMINDER_INTERVAL = 10
export const REMINDER_INTERVAL_MIN = 5
export const REMINDER_INTERVAL_MAX = 3600

/** 间隔钳制：非法/非有限值回退默认；有效值取整并夹在 [5, 3600]。 */
export function clampReminderInterval(sec: number): number {
  if (!Number.isFinite(sec)) return DEFAULT_REMINDER_INTERVAL
  return Math.min(REMINDER_INTERVAL_MAX, Math.max(REMINDER_INTERVAL_MIN, Math.round(sec)))
}

function readReminderInterval(): number {
  try {
    const raw = localStorage.getItem(REMINDER_INTERVAL_KEY)
    if (raw !== null) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= REMINDER_INTERVAL_MIN && n <= REMINDER_INTERVAL_MAX) {
        return Math.round(n)
      }
    }
  } catch { /* private mode / 非浏览器环境 */ }
  return DEFAULT_REMINDER_INTERVAL
}

let loopReminder = readBoolFlag(LOOP_REMINDER_KEY, DEFAULT_LOOP_REMINDER)
let intervalSec = readReminderInterval()
const loopListeners = new Set<(on: boolean) => void>()
const intervalListeners = new Set<(sec: number) => void>()

export function getLoopReminder(): boolean {
  return loopReminder
}

export function setLoopReminder(value: boolean): void {
  if (loopReminder === value) return
  loopReminder = value
  writeBoolFlag(LOOP_REMINDER_KEY, value)
  for (const fn of loopListeners) fn(value)
}

/** React useSyncExternalStore 订阅（模块级单例，无 React 依赖）。 */
export function subscribeLoopReminder(fn: (on: boolean) => void): () => void {
  loopListeners.add(fn)
  return () => { loopListeners.delete(fn) }
}

export function getReminderInterval(): number {
  return intervalSec
}

/** 设置间隔（秒）：自动钳制到 [5, 3600] 并取整，无变化不通知。 */
export function setReminderInterval(sec: number): void {
  const next = clampReminderInterval(sec)
  if (intervalSec === next) return
  intervalSec = next
  try { localStorage.setItem(REMINDER_INTERVAL_KEY, String(next)) } catch { /* quota / private mode */ }
  for (const fn of intervalListeners) fn(next)
}

export function subscribeReminderInterval(fn: (sec: number) => void): () => void {
  intervalListeners.add(fn)
  return () => { intervalListeners.delete(fn) }
}

/** 测试辅助：复位到出厂默认并清空持久化。 */
export function resetReminderSettings(): void {
  loopReminder = DEFAULT_LOOP_REMINDER
  intervalSec = DEFAULT_REMINDER_INTERVAL
  writeBoolFlag(LOOP_REMINDER_KEY, loopReminder)
  try { localStorage.setItem(REMINDER_INTERVAL_KEY, String(intervalSec)) } catch { /* quota / private mode */ }
  for (const fn of loopListeners) fn(loopReminder)
  for (const fn of intervalListeners) fn(intervalSec)
}
