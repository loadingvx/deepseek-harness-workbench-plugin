/** 自动 git fetch 间隔：用户偏好（分钟）+ 失败退避计算。 */

export const AUTO_FETCH_DEFAULT_MINUTES = 60
export const AUTO_FETCH_MIN_MINUTES = 5
export const AUTO_FETCH_MAX_MINUTES = 24 * 60
/** 0 = 关闭自动获取，仅手动。 */
export const AUTO_FETCH_OFF_MINUTES = 0
export const AUTO_FETCH_PRESETS = [15, 30, 60, 120, 360] as const

export type AutoFetchParseFail = 'empty' | 'invalid' | 'low' | 'high'

export function autoFetchMinutesToMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.floor(minutes) * 60_000
}

export function parseAutoFetchMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return AUTO_FETCH_DEFAULT_MINUTES
  const value = Math.floor(raw)
  if (value === AUTO_FETCH_OFF_MINUTES) return AUTO_FETCH_OFF_MINUTES
  if (value < AUTO_FETCH_MIN_MINUTES || value > AUTO_FETCH_MAX_MINUTES) {
    return AUTO_FETCH_DEFAULT_MINUTES
  }
  return value
}

/** 设置弹窗：空 / 非整数 / 越界；0 表示关闭。 */
export function parseAutoFetchMinutesInput(raw: string):
  { ok: true; value: number } | { ok: false; error: AutoFetchParseFail } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, error: 'empty' }
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'invalid' }
  const value = Number(trimmed)
  if (value === AUTO_FETCH_OFF_MINUTES) return { ok: true, value: AUTO_FETCH_OFF_MINUTES }
  if (value < AUTO_FETCH_MIN_MINUTES) return { ok: false, error: 'low' }
  if (value > AUTO_FETCH_MAX_MINUTES) return { ok: false, error: 'high' }
  return { ok: true, value }
}

/**
 * 下次自动 fetch 的等待毫秒。
 * - 关闭（configuredMs ≤ 0）→ 0
 * - 成功 → 用户配置间隔
 * - 失败 → max(配置间隔, 本次耗时 × 2)，避免短间隔反复撞车
 */
export function nextAutoFetchDelayMs(
  configuredMs: number,
  failed: boolean,
  lastDurationMs: number,
): number {
  if (configuredMs <= 0) return 0
  if (!failed) return configuredMs
  const duration = Number.isFinite(lastDurationMs) && lastDurationMs > 0
    ? lastDurationMs
    : 0
  return Math.max(configuredMs, duration * 2)
}
