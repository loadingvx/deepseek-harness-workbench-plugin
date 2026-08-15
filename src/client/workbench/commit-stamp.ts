function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parseCommitDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function hms(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/** Full local stamp for hover: 2026-03-01 14:32:01 */
export function formatCommitTooltip(raw: string): string {
  const date = parseCommitDate(raw)
  if (date === null) return ''
  return `${ymd(date)} ${hms(date)}`
}

/**
 * Same calendar day → 14:32:01
 * Any other day → 2026-03-01
 */
export function formatCommitStamp(raw: string, now = new Date()): string {
  const date = parseCommitDate(raw)
  if (date === null) return ''
  return sameLocalDay(date, now) ? hms(date) : ymd(date)
}
