import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './GitToolRow.module.css'

type GitToolRowProps = ToolCallViewProps & PropsLocale<'workbench'>

function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block) || block.content === undefined) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? (item.text ?? '') : JSON.stringify(item, null, 2))
  }
  return parts.join('\n') || null
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

const TITLES: Record<string, 'tool.git_status' | 'tool.git_diff' | 'tool.git_log' | 'tool.git_branch' | 'tool.git_commit'> = {
  git_status: 'tool.git_status',
  git_diff: 'tool.git_diff',
  git_log: 'tool.git_log',
  git_branch: 'tool.git_branch',
  git_commit: 'tool.git_commit',
}

/** Dedicated conversation card for git_* tool calls. */
export function GitToolRow({ block, toolName, t }: GitToolRowProps) {
  const settled = 'kind' in block
  const state = !settled ? 'running' : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  const [open, setOpen] = useState(state === 'error')
  const titleKey = TITLES[toolName] ?? 'tool.git_status'
  const summary = output === null ? t(`row.${state}`) : firstLine(output)
  return (
    <div className={css.card} data-tool={toolName} data-state={state}>
      <div className={css.row}>
        <span className={css.dot} aria-hidden />
        <span className={css.title}>{t(titleKey)}</span>
        <span className={css.summary}>{summary}</span>
        {output !== null ? (
          <button type="button" className={css.toggle} onClick={() => { setOpen(value => !value) }}>
            {t('row.output')}
          </button>
        ) : null}
      </div>
      {open && output !== null ? <pre className={css.body}>{output}</pre> : null}
    </div>
  )
}
