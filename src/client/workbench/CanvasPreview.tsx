import React, { useEffect, useMemo, useState } from 'react'
import type { GitClient } from '../api.ts'
import { mountCanvasComponent } from '../../shared/canvas-prepare.ts'
import type { Translate } from './types.ts'
import css from './CanvasPreview.module.css'

export function CanvasPreview({
  client,
  source,
  t,
}: {
  client: GitClient
  source: string
  t: Translate
}) {
  const [transpiled, setTranspiled] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const trimmed = source.trim()
    if (trimmed === '') {
      setTranspiled(null)
      setError(null)
      setBusy(false)
      return
    }
    let cancelled = false
    setBusy(true)
    void client.compileCanvas(trimmed).then((result) => {
      if (cancelled) return
      setBusy(false)
      if (!result.ok) {
        setTranspiled(null)
        setError(result.messageZh || t('editor.canvasPreviewFail'))
        return
      }
      setTranspiled(result.value.code)
      setError(null)
    })
    return () => { cancelled = true }
  }, [client, source])

  const compiled = useMemo(() => {
    if (transpiled === null) return null
    return mountCanvasComponent(transpiled, React)
  }, [transpiled])

  if (source.trim() === '') {
    return (
      <div className={css.root} role="region" aria-label={t('editor.canvasPreview')}>
        <p className={css.empty}>{t('editor.canvasPreviewEmpty')}</p>
      </div>
    )
  }

  if (busy && compiled === null && error === null) {
    return (
      <div className={css.root} role="region" aria-label={t('editor.canvasPreview')}>
        <p className={css.empty}>{t('panel.loading')}</p>
      </div>
    )
  }

  if (error !== null || compiled === null || !compiled.ok) {
    const message = error ?? (compiled !== null && !compiled.ok ? compiled.message : t('editor.canvasPreviewFail'))
    return (
      <div className={css.root} role="region" aria-label={t('editor.canvasPreview')}>
        <p className={css.error}>{message}</p>
        <p className={css.hint}>{t('editor.canvasPreviewFail')}</p>
      </div>
    )
  }

  const Component = compiled.Component
  return (
    <div className={css.root} role="region" aria-label={t('editor.canvasPreview')}>
      <div className={css.stage}>
        <Component />
      </div>
    </div>
  )
}
