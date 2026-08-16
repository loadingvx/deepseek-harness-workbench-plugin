import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { markdownFileFromClick, renderMarkdownHtml } from './markdown-html.ts'
import { renderMermaidBlocks } from './mermaid-render.ts'
import type { Translate } from './types.ts'
import css from './MarkdownPreview.module.css'

export function MarkdownPreview({
  path,
  markdown,
  onOpenFile,
  t,
  workspaceId,
}: {
  path: string
  markdown: string
  onOpenFile: (path: string) => void
  t: Translate
  workspaceId?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    if (markdown.trim() === '') return ''
    try {
      return renderMarkdownHtml(path, markdown, {
        linkBlocked: t('editor.mdLinkBlocked'),
        imageSkip: t('editor.mdImageSkip'),
        fileLinkClass: css.fileLink,
        imgSkipClass: css.imgSkip,
      }, workspaceId)
    } catch {
      return null
    }
  }, [path, markdown, t, workspaceId])

  useEffect(() => {
    const root = bodyRef.current
    if (root === null) return
    let cancelled = false
    void renderMermaidBlocks(
      root,
      { host: css.mermaidHost, error: css.mermaidError },
      t('editor.mdMermaidFail'),
      () => cancelled,
    )
    return () => { cancelled = true }
  }, [html, t])

  if (markdown.trim() === '') {
    return (
      <div className={css.root} role="article" aria-label={t('editor.mdPreview')}>
        <p className={css.empty}>{t('editor.mdPreviewEmpty')}</p>
      </div>
    )
  }

  if (html === null) {
    return (
      <div className={css.root} role="article" aria-label={t('editor.mdPreview')}>
        <p className={css.empty}>{t('editor.mdPreviewFail')}</p>
      </div>
    )
  }

  const onClick = (event: MouseEvent<HTMLElement>): void => {
    const file = markdownFileFromClick(event)
    if (file !== null) onOpenFile(file)
  }

  return (
    <div className={css.root} role="article" aria-label={t('editor.mdPreview')} onClick={onClick}>
      <div className={css.body} ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
