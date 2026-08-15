import { useEffect, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { PluginUpdateSnapshot } from '../../shared/types.ts'
import { IconClose } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './UpdateBanner.module.css'

const SKIP_PREFIX = 'dsh-workbench-plugin:skip-update:'

function skipped(latest: string): boolean {
  try {
    return window.localStorage.getItem(`${SKIP_PREFIX}${latest}`) === '1'
  } catch {
    return false
  }
}

function skip(latest: string): void {
  try {
    window.localStorage.setItem(`${SKIP_PREFIX}${latest}`, '1')
  } catch { /* private mode */ }
}

export function usePluginUpdate(client: GitClient): PluginUpdateSnapshot | null {
  const [info, setInfo] = useState<PluginUpdateSnapshot | null>(null)

  useEffect(() => {
    let live = true
    void client.pluginUpdate().then((result) => {
      if (!live || !result.ok) return
      setInfo(result.value)
    })
    return () => { live = false }
  }, [client])

  return info
}

export function visibleUpdate(info: PluginUpdateSnapshot | null): PluginUpdateSnapshot | null {
  if (info === null || !info.outdated || info.latest === null) return null
  if (skipped(info.latest)) return null
  return info
}

export function UpdateBanner({
  info,
  onDismiss,
  t,
}: {
  info: PluginUpdateSnapshot | null
  onDismiss: () => void
  t: Translate
}) {
  if (info === null || info.latest === null) return null

  return (
    <div className={css.bar} role="status">
      <div className={css.text}>{t('update.title', { latest: info.latest, current: info.current })}</div>
      <button
        type="button"
        className={css.close}
        aria-label={t('update.close')}
        title={t('update.close')}
        onClick={() => {
          skip(info.latest!)
          onDismiss()
        }}
      >
        <IconClose />
      </button>
    </div>
  )
}
