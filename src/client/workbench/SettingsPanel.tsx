/**
 * 插件设置面板（侧栏最右 settings 标签）
 *
 * 由「全局会话监控」面板迁移而来：会话列表（需要你注意 / 运行中）已删除，
 * 整体的提示信息交由原生左侧会话列表的状态点机制承担；本面板只保留设置类内容。
 *
 * 布局仿照 Git 侧栏 CHANGES / GRAPH 的折叠分区（sectionHead + 可折叠 paneBody）：
 * ① 声音与提醒 —— 提示音总闸、铃声选择、循环提醒与间隔；
 * ② 插件命令 —— 复用 SlashPanel 的 SettingsSection（内置 / 自定义斜杠命令管理）；
 * ③ 智能体控制面 —— 编辑器首 Tab「Agent Control Plane」显示开关；
 * ④ 会话渲染增强 —— 会话中 SVG 标签回答的渲染开关。
 */
import { useRef, useState, useSyncExternalStore } from 'react'
import {
  REMINDER_INTERVAL_MAX,
  REMINDER_INTERVAL_MIN,
} from './reminder-settings.ts'
import type { Translate } from './types.ts'
import { useBeepOn, useLoopReminder, useReminderInterval } from './useSessionMonitor.ts'
import { useSvgRenderOn } from './svg-render-settings.ts'
import { SVG_RENDER_EXAMPLE } from './svg-tail.ts'
import { IconChevron } from './icons.tsx'
import { SoundSettings } from './SoundSettings.tsx'
import { SettingsSection } from '../ultra-slash/SlashPanel.tsx'
import { getSlashCache, getSlashI18n, subscribeSlashI18n } from '../ultra-slash/runtime.ts'
import {
  DEFAULT_SETTINGS_COMMANDS_OPEN,
  DEFAULT_SETTINGS_CONTROL_PLANE_OPEN,
  DEFAULT_SETTINGS_SOUND_OPEN,
  DEFAULT_SETTINGS_SVG_RENDER_OPEN,
  readBoolFlag,
  SETTINGS_COMMANDS_OPEN_KEY,
  SETTINGS_CONTROL_PLANE_OPEN_KEY,
  SETTINGS_SOUND_OPEN_KEY,
  SETTINGS_SVG_RENDER_OPEN_KEY,
  writeBoolFlag,
} from './ui-flags.ts'
import { useControlPlaneVisible } from './control-plane-settings.ts'
import css from './SettingsPanel.module.css'

/** 设置行右侧的开关（role="switch"）。 */
function SettingsSwitch({ on, disabled, label, title, onToggle }: {
  on: boolean
  disabled?: boolean
  label: string
  title: string
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className={css.switch}
      data-on={on || undefined}
      aria-checked={on}
      disabled={disabled}
      aria-label={label}
      title={title}
      onClick={() => { onToggle(!on) }}
    />
  )
}

export function SettingsPanel({ t }: { t: Translate }) {
  const [beepOn, setBeepOn] = useBeepOn()
  const [loopOn, setLoopOn] = useLoopReminder()
  const [intervalSec, setIntervalSec] = useReminderInterval()
  const [svgRenderOn, setSvgRenderOn] = useSvgRenderOn()
  const [controlPlaneOn, setControlPlaneOn] = useControlPlaneVisible()
  // 循环提醒生效 = 提示音总闸开启 且 循环提醒子开关开启（提示音关闭时联动失效，UI 与行为一致）
  const loopActive = beepOn && loopOn
  // 间隔输入草稿：键入过程中不写偏好，失焦 / Enter 才提交，非法输入回退
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const intervalDraftRef = useRef<string | null>(null)
  const updateIntervalDraft = (value: string): void => {
    intervalDraftRef.current = value
    setIntervalDraft(value)
  }
  const commitInterval = (): void => {
    const draft = intervalDraftRef.current
    intervalDraftRef.current = null
    setIntervalDraft(null)
    if (draft === null) return
    const trimmed = draft.trim()
    if (trimmed === '') return
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    setIntervalSec(n)
  }
  const slashI18n = useSyncExternalStore(subscribeSlashI18n, getSlashI18n, getSlashI18n)

  const [soundOpen, setSoundOpen] = useState(() => readBoolFlag(SETTINGS_SOUND_OPEN_KEY, DEFAULT_SETTINGS_SOUND_OPEN))
  const [commandsOpen, setCommandsOpen] = useState(() => readBoolFlag(SETTINGS_COMMANDS_OPEN_KEY, DEFAULT_SETTINGS_COMMANDS_OPEN))
  const [svgRenderOpen, setSvgRenderOpen] = useState(() => readBoolFlag(SETTINGS_SVG_RENDER_OPEN_KEY, DEFAULT_SETTINGS_SVG_RENDER_OPEN))
  const [controlPlaneOpen, setControlPlaneOpen] = useState(() => readBoolFlag(SETTINGS_CONTROL_PLANE_OPEN_KEY, DEFAULT_SETTINGS_CONTROL_PLANE_OPEN))
  const toggleSound = (): void => {
    setSoundOpen((open) => {
      writeBoolFlag(SETTINGS_SOUND_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleCommands = (): void => {
    setCommandsOpen((open) => {
      writeBoolFlag(SETTINGS_COMMANDS_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleSvgRender = (): void => {
    setSvgRenderOpen((open) => {
      writeBoolFlag(SETTINGS_SVG_RENDER_OPEN_KEY, !open)
      return !open
    })
  }
  const toggleControlPlane = (): void => {
    setControlPlaneOpen((open) => {
      writeBoolFlag(SETTINGS_CONTROL_PLANE_OPEN_KEY, !open)
      return !open
    })
  }

  return (
    <div className={css.root}>
      <div className={css.head}>
        <span className={css.title}>{t('settings.title')}</span>
      </div>
      <div className={css.body}>
        <section className={css.pane} data-open={soundOpen || undefined}>
          <div className={css.sectionHead}>
            <button type="button" className={css.sectionToggle} aria-expanded={soundOpen} onClick={toggleSound}>
              <IconChevron open={soundOpen} />
              <span className={css.sectionTitle}>{t('settings.section.sound')}</span>
            </button>
          </div>
          {soundOpen ? (
            <div className={css.paneBody}>
              <div className={css.settingRow}>
                <span className={css.settingLabel}>{t('settings.beepLabel')}</span>
                <SettingsSwitch
                  on={beepOn}
                  label={beepOn ? t('sessions.beepOff') : t('sessions.beepOn')}
                  title={beepOn ? t('sessions.beepOnHint') : t('sessions.beepOffHint')}
                  onToggle={setBeepOn}
                />
              </div>
              <div className={css.settingRow}>
                <span className={css.settingLabel} data-dimmed={!beepOn || undefined}>
                  {t('settings.loopLabel')}
                </span>
                <SettingsSwitch
                  on={loopActive}
                  disabled={!beepOn}
                  label={!beepOn ? t('sessions.loopDisabledHint') : loopOn ? t('sessions.loopOff') : t('sessions.loopOn')}
                  title={!beepOn ? t('sessions.loopDisabledHint') : loopOn ? t('sessions.loopOnHint', { n: intervalSec }) : t('sessions.loopOffHint')}
                  onToggle={setLoopOn}
                />
              </div>
              {loopActive ? (
                <label className={css.settingRow} title={t('sessions.intervalHint', { min: REMINDER_INTERVAL_MIN, max: REMINDER_INTERVAL_MAX })}>
                  <span className={css.settingLabel}>{t('sessions.intervalLabel')}</span>
                  <span className={css.intervalControl}>
                    <input
                      type="number"
                      className={css.intervalInput}
                      min={REMINDER_INTERVAL_MIN}
                      max={REMINDER_INTERVAL_MAX}
                      step={5}
                      value={intervalDraft ?? String(intervalSec)}
                      onChange={(event) => { updateIntervalDraft(event.target.value) }}
                      onBlur={commitInterval}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') {
                          intervalDraftRef.current = null
                          setIntervalDraft(null)
                          event.currentTarget.blur()
                        }
                      }}
                      aria-label={t('sessions.intervalLabel')}
                    />
                    <span className={css.intervalUnit}>{t('sessions.intervalUnit')}</span>
                  </span>
                </label>
              ) : null}
              <div className={css.soundBlock}>
                <SoundSettings t={t} />
              </div>
            </div>
          ) : null}
        </section>

        <section className={css.pane} data-open={commandsOpen || undefined}>
          <div className={css.sectionHead}>
            <button type="button" className={css.sectionToggle} aria-expanded={commandsOpen} onClick={toggleCommands}>
              <IconChevron open={commandsOpen} />
              <span className={css.sectionTitle}>{t('settings.section.commands')}</span>
            </button>
          </div>
          {commandsOpen ? (
            <div className={css.paneBody}>
              {/* embedded：隐藏 SettingsSection 自带标题，避免与分区头重复 */}
              <SettingsSection embedded t={slashI18n.t} locale={slashI18n.locale} cache={getSlashCache()} />
            </div>
          ) : null}
        </section>

        <section className={css.pane} data-open={controlPlaneOpen || undefined}>
          <div className={css.sectionHead}>
            <button type="button" className={css.sectionToggle} aria-expanded={controlPlaneOpen} onClick={toggleControlPlane}>
              <IconChevron open={controlPlaneOpen} />
              <span className={css.sectionTitle}>{t('settings.section.controlPlane')}</span>
            </button>
          </div>
          {controlPlaneOpen ? (
            <div className={css.paneBody}>
              <div className={css.settingRow}>
                <span className={css.settingLabel}>{t('settings.controlPlaneLabel')}</span>
                <SettingsSwitch
                  on={controlPlaneOn}
                  label={controlPlaneOn ? t('settings.controlPlaneOff') : t('settings.controlPlaneOn')}
                  title={controlPlaneOn ? t('settings.controlPlaneOnHint') : t('settings.controlPlaneOffHint')}
                  onToggle={setControlPlaneOn}
                />
              </div>
              <p className={css.svgRenderTipText}>{t('settings.controlPlaneTip')}</p>
            </div>
          ) : null}
        </section>

        <section className={css.pane} data-open={svgRenderOpen || undefined}>
          <div className={css.sectionHead}>
            <button type="button" className={css.sectionToggle} aria-expanded={svgRenderOpen} onClick={toggleSvgRender}>
              <IconChevron open={svgRenderOpen} />
              <span className={css.sectionTitle}>{t('settings.section.svgRender')}</span>
            </button>
          </div>
          {svgRenderOpen ? (
            <div className={css.paneBody}>
              <div className={css.settingRow}>
                <span className={css.settingLabel}>{t('settings.svgRenderLabel')}</span>
                <SettingsSwitch
                  on={svgRenderOn}
                  label={svgRenderOn ? t('settings.svgRenderOff') : t('settings.svgRenderOn')}
                  title={svgRenderOn ? t('settings.svgRenderOnHint') : t('settings.svgRenderOffHint')}
                  onToggle={setSvgRenderOn}
                />
              </div>
              <div className={css.svgRenderTip}>
                <span className={css.svgRenderTipText}>{t('settings.svgRenderTip')}</span>
                <code className={css.svgRenderTipCode}>{SVG_RENDER_EXAMPLE}</code>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
