import { Marked, type Renderer, type Tokens } from 'marked'
import { classifyMarkdownHref, classifyMarkdownImageSrc } from './markdown-href.ts'

export const MARKDOWN_FILE_ATTR = 'data-dsw-file'

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function titleAttr(title: string | null | undefined): string {
  if (title === null || title === undefined || title === '') return ''
  return ' title="' + escapeAttr(title) + '"'
}

function imageSkipSpan(
  labels: { imageSkip: string; imgSkipClass: string },
  altText: string,
): string {
  const shown = altText.trim() !== '' ? escapeAttr(altText) : escapeAttr(labels.imageSkip)
  return '<span class="' + escapeAttr(labels.imgSkipClass) + '" title="' + escapeAttr(labels.imageSkip) + '">' + shown + '</span>'
}

/**
 * Render markdown to sanitized HTML. \`workspaceId\`, when given, lets
 * workspace-relative images point at /git/fs/img so they render in the preview.
 */
export function renderMarkdownHtml(
  fromFile: string,
  markdown: string,
  labels: { linkBlocked: string; imageSkip: string; fileLinkClass: string; imgSkipClass: string },
  workspaceId?: string,
): string {
  const marked = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: {
      html() {
        return ''
      },
      link(this: Renderer, { href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        const target = classifyMarkdownHref(fromFile, href)
        if (target === null) {
          return '<span title="' + escapeAttr(labels.linkBlocked) + '">' + text + '</span>'
        }
        const extra = titleAttr(title)
        if (target.kind === 'file') {
          return '<button type="button" class="' + escapeAttr(labels.fileLinkClass) + '" ' + MARKDOWN_FILE_ATTR + '="' + escapeAttr(target.value) + '"' + extra + '>' + text + '</button>'
        }
        if (target.kind === 'hash') {
          return '<a href="' + escapeAttr(target.value) + '"' + extra + '>' + text + '</a>'
        }
        return '<a href="' + escapeAttr(target.value) + '" target="_blank" rel="noopener noreferrer"' + extra + '>' + text + '</a>'
      },
      image({ href, title, text }: Tokens.Image) {
        const target = classifyMarkdownImageSrc(fromFile, href)
        if (target === null) return imageSkipSpan(labels, text)
        const src = target.kind === 'url'
          ? target.value
          : workspaceId !== undefined && workspaceId !== ''
            ? '/git/fs/img?workspaceId=' + encodeURIComponent(workspaceId) + '&path=' + encodeURIComponent(target.value)
            : null
        if (src === null) return imageSkipSpan(labels, text)
        return '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(text) + '"' + titleAttr(title) + '>'
      },
    },
  })
  const html = marked.parse(markdown, { async: false })
  if (typeof html !== 'string') throw new Error('markdown parse must be sync')
  return html
}

export function markdownFileFromClick(event: { target: EventTarget | null; preventDefault: () => void }): string | null {
  const node = event.target
  if (!(node instanceof Element)) return null
  const el = node.closest('[' + MARKDOWN_FILE_ATTR + ']')
  if (el === null) return null
  event.preventDefault()
  const path = el.getAttribute(MARKDOWN_FILE_ATTR)
  return path !== null && path !== '' ? path : null
}
