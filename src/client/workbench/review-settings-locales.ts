/** Locale strings for the Change review (Keep / Undo) settings section. */
export const reviewSettingsZh = {
  'settings.section.review': '改动确认',
  'settings.reviewLabel': '启用改动确认',
  'settings.reviewOn': '开启改动确认',
  'settings.reviewOff': '关闭改动确认',
  'settings.reviewOnHint': '已开启：Agent 写入后可 Keep / Undo 确认（点击关闭）',
  'settings.reviewOffHint': '已关闭：Agent 写入直接生效，不进入确认列表（点击开启）',
  'settings.reviewTip': '开启后，Agent 通过 write / edit 改过的文件会出现在侧栏「改动确认」列表，并可在编辑器里 Keep（保留现状）或 Undo（回到改之前）。关闭后改动直接落盘，不再收集待确认项。',
}

export const reviewSettingsEn = {
  'settings.section.review': 'Change review',
  'settings.reviewLabel': 'Enable change review',
  'settings.reviewOn': 'Enable change review',
  'settings.reviewOff': 'Disable change review',
  'settings.reviewOnHint': 'On: Agent writes can be Kept / Undone (click to turn off)',
  'settings.reviewOffHint': 'Off: Agent writes apply immediately with no review queue (click to turn on)',
  'settings.reviewTip': 'When enabled, files the Agent changes with write / edit appear in the Change review side tab, and you can Keep (accept) or Undo (restore) in the editor. When disabled, writes land on disk with no pending review.',
}
