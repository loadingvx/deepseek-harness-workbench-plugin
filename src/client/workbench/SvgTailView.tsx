/**
 * 会话渲染增强 · SVG 回答可视化视图（conversation.chat.turnTail 卡片渲染）。
 *
 * select（svg-render-settings.ts 的 selectSvgTailGated）返回匹配到的 SVG 列表，
 * 经 props.matched 注入；本视图对每个标准 SVG 渲染一张卡片（dangerouslySetInnerHTML
 * 注入，注入前已做最小安全清洗）。开关关闭时 select 返回 null，本视图不渲染。
 *
 * 卡片右上角提供 "..." 菜单（IconMore + ContextMenu）：
 *  - 下载为 HTML（svgToHtml + downloadBlob）
 *  - 下载为图片（svgToPng + downloadBlob）
 *  - 复制代码（copyText）
 */
import { useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { sanitizeSvg } from './svg-tail.ts'
import {
  copyText,
  downloadBlob,
  svgToHtml,
  svgToPng,
} from './svg-card-actions.ts'
import { IconButton } from './IconButton.tsx'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu.tsx'
import { IconCopy, IconMore } from './icons.tsx'
import css from './SvgTailView.module.css'

export interface SvgTailViewProps extends PropsLocale<'workbench'> {
  /** turnTail select 匹配结果：标准 SVG 字符串数组（或 null/undefined）。 */
  matched?: unknown
}

interface MenuPos {
  x: number
  y: number
}

export function SvgTailView({ matched, t }: SvgTailViewProps): ReactElement | null {
  const svgs = Array.isArray(matched) ? matched.filter((s): s is string => typeof s === 'string') : []
  if (svgs.length === 0) return null
  return (
    <div className={css.tail}>
      {svgs.map((svg, index) => {
        const clean = sanitizeSvg(svg)
        if (clean === null) return null
        return <SvgCard key={index} index={index} svg={clean} t={t} />
      })}
    </div>
  )
}

function SvgCard({ index, svg, t }: { index: number; svg: string; t: SvgTailViewProps['t'] }): ReactElement {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const showNotice = (message: string): void => {
    setNotice(message)
    window.setTimeout(() => { setNotice(null) }, 1800)
  }

  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPos({ x: rect.right - 4, y: rect.bottom + 4 })
  }

  const items: ContextMenuEntry[] = [
    {
      kind: 'item',
      id: 'download-html',
      label: t('svgCard.downloadHtml'),
      onClick: () => {
        downloadBlob(new Blob([svgToHtml(svg)], { type: 'text/html;charset=utf-8' }), `svg-${index + 1}.html`)
      },
    },
    {
      kind: 'item',
      id: 'download-image',
      label: t('svgCard.downloadImage'),
      onClick: () => {
        svgToPng(svg).then((blob) => {
          downloadBlob(blob, `svg-${index + 1}.png`)
        }).catch(() => {
          showNotice(t('svgCard.downloadImageFailed'))
        })
      },
    },
    {
      kind: 'item',
      id: 'copy-code',
      label: t('svgCard.copyCode'),
      icon: <IconCopy />,
      onClick: () => {
        copyText(svg).then((ok) => {
          showNotice(ok ? t('svgCard.copied') : t('svgCard.copyFailed'))
        })
      },
    },
  ]

  return (
    <>
      <div className={css.cardWrap}>
        <div className={css.card} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className={css.cardToolbar}>
          <IconButton dense label={t('svgCard.menu')} className={css.moreBtn} onClick={openMenu}>
            <IconMore />
          </IconButton>
        </div>
        {notice !== null ? (
          <div className={css.notice} role="status">{notice}</div>
        ) : null}
      </div>
      {menuPos !== null ? (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={items}
          ariaLabel={t('svgCard.menu')}
          onClose={() => { setMenuPos(null) }}
        />
      ) : null}
    </>
  )
}
