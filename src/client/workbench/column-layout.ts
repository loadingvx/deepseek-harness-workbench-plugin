export const RAIL_W = 36
export const SIDE_DEFAULT = 280
export const SIDE_MIN = 200
export const SIDE_HARD_MIN = 160
export const SIDE_MAX = 560
export const CHAT_MIN = 280
export const CHAT_HARD_MIN = 160
export const EDITOR_MIN = 240
export const CHAT_RATIO = 0.38

export const CHAT_W_KEY = 'dsh-workbench-chat-w'
export const SIDE_W_KEY = 'dsh-workbench-side-w'

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return max
  return Math.min(max, Math.max(min, value))
}

export function readPx(key: string, fallback: number): number {
  try {
    const raw = Number(localStorage.getItem(key))
    if (Number.isFinite(raw) && raw >= 80) return Math.round(raw)
  } catch { /* ignore */ }
  return fallback
}

export function writePx(key: string, value: number): void {
  try { localStorage.setItem(key, String(Math.round(value))) } catch { /* ignore */ }
}

export function clampLayout(
  hostW: number,
  chat: number,
  side: number,
  open: { chat: boolean; editor: boolean; side: boolean },
): { chat: number; side: number } {
  let nextChat = open.chat ? Math.max(CHAT_MIN, chat) : chat
  let nextSide = open.side ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, side)) : side
  const used = (open.chat ? nextChat : RAIL_W)
    + (open.editor ? EDITOR_MIN : RAIL_W)
    + (open.side ? nextSide : RAIL_W)
  let overflow = used - hostW
  if (overflow <= 0 || hostW <= 0) return { chat: nextChat, side: nextSide }
  const shrink = (current: number, floor: number): number => {
    const take = Math.min(overflow, Math.max(0, current - floor))
    overflow -= take
    return current - take
  }
  if (open.side) nextSide = shrink(nextSide, SIDE_MIN)
  if (open.chat && overflow > 0) nextChat = shrink(nextChat, CHAT_MIN)
  if (open.side && overflow > 0) nextSide = shrink(nextSide, SIDE_HARD_MIN)
  if (open.chat && overflow > 0) nextChat = shrink(nextChat, CHAT_HARD_MIN)
  return { chat: nextChat, side: nextSide }
}
