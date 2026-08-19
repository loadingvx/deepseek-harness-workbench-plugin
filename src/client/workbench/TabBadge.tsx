import css from './TabBadge.module.css'

/**
 * 标签角标：全局会话监控标签右上角的数字提醒。
 * attention = 需要注意（等待审批/方案确认/提问、完成未查看）红色；running = 运行中琥珀色。
 */
export function TabBadge({ count, tone }: { count: number; tone: 'attention' | 'running' }) {
  if (count <= 0) return null
  return (
    <span className={`${css.badge} ${tone === 'attention' ? css.attention : css.running}`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
