import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Translate } from '../types.ts'
import { tabCloseTargets } from './tab-close-targets.ts'
import css from './TabCloseMenu.module.css'

export type TabCloseMenuProps =
  PropsRuntime<'sidebar.right.tab.menu.item'>
  & PropsLocale
  & {
    t: Translate
    closeTab: (tabId: string) => void
  }

function MenuItem({
  label,
  disabled,
  title,
  onClick,
}: {
  label: string
  disabled: boolean
  title?: string
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      className={css.item}
      disabled={disabled}
      title={disabled ? title : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * Extra close actions after the kit's built-in Close: others / all / left / right.
 * Uses the same pane strip as the chip that opened the menu.
 */
export function TabCloseMenu({ tab, dismiss, t, closeTab }: TabCloseMenuProps): ReactNode {
  const targets = tabCloseTargets(tab.id)
  const closeMany = (ids: string[]): void => {
    dismiss()
    for (const id of ids) closeTab(id)
  }
  return (
    <>
      <MenuItem
        label={t('editor.closeOthers')}
        disabled={targets.others.length === 0}
        title={t('editor.closeOthersDisabled')}
        onClick={() => { closeMany(targets.others) }}
      />
      <MenuItem
        label={t('editor.closeAll')}
        disabled={targets.all.length === 0}
        title={t('editor.closeAllDisabled')}
        onClick={() => { closeMany(targets.all) }}
      />
      <div className={css.sep} aria-hidden="true" />
      <MenuItem
        label={t('editor.closeLeft')}
        disabled={targets.left.length === 0}
        title={t('editor.closeLeftDisabled')}
        onClick={() => { closeMany(targets.left) }}
      />
      <MenuItem
        label={t('editor.closeRight')}
        disabled={targets.right.length === 0}
        title={t('editor.closeRightDisabled')}
        onClick={() => { closeMany(targets.right) }}
      />
    </>
  )
}
