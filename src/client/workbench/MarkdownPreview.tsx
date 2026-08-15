import { useMemo, type MouseEvent } from 'react'
import { markdownFileFromClick, renderMarkdownHtml } from './markdown-html.ts'
import type { Translate } from './types.ts'
import css from './MarkdownPreview.module.css'

export function MarkdownPreview({
  path,
  markdown,
  onOpenFile,
  t,
}: {
  path: string
  markdown: string
  onOpenFile: (path: string) => void
  t: Translate
}) {
  const html = useMemo(() => {
    if (markdown.trim() === '') return ''
    try {
      return renderMarkdownHtml(path, markdown, {
        linkBlocked: t('editor.mdLinkBlocked'),
        imageSkip: t('editor.mdImageSkip'),
        fileLinkClass: css.fileLink,
        imgSkipClass: css.imgSkip,
      })
    } catch {
      return null
    }
  }, [path, markdown, t])

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
      <div className={css.body} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
