export const IDE_STYLE_ID = 'dsh-git-plugin/ide-split'

/**
 * Split the conversation COLUMN (parent of the native scrollport).
 * Never change display/overflow on [data-conversation-scroll]: that node is
 * the chat scrollport, and the composer must stay position:sticky inside it.
 */
export const IDE_HOST_CSS = `
[data-git-ide]{
  display:grid !important;
  grid-template-columns: var(--git-col-chat, minmax(280px, 38%)) var(--git-col-editor, minmax(0, 1fr)) var(--git-col-side, 280px);
  grid-template-rows: auto minmax(0, 1fr);
  align-items: stretch;
  overflow: hidden !important;
  min-height: 0 !important;
  height: 100%;
}
[data-git-ide] > :not([data-conversation-scroll]):not([data-git-ide-panel]){
  grid-column: 1 / -1;
  grid-row: 1;
  min-width: 0;
}
[data-git-ide] > [data-conversation-scroll]{
  grid-column: 1;
  grid-row: 2;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 100%;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
[data-git-ide][data-git-chat=off] > [data-conversation-scroll]{
  display: none !important;
}
[data-git-ide-panel=editor],
[data-git-ide-panel=side]{
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
}
[data-git-ide-panel=editor]{ grid-column: 2; grid-row: 2; }
[data-git-ide-panel=side]{ grid-column: 3; grid-row: 2; }
[data-git-ide-panel=rail-chat]{ grid-column: 1; grid-row: 2; }
[data-git-ide-panel=rail-editor]{ grid-column: 2; grid-row: 2; }
[data-git-ide-panel=rail-side]{ grid-column: 3; grid-row: 2; }
`

export function ensureIdeStyles(): void {
  if (document.querySelector(`style[data-plugin-css="${IDE_STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-git-plugin'
  tag.dataset.pluginCss = IDE_STYLE_ID
  tag.textContent = IDE_HOST_CSS
  document.head.appendChild(tag)
}

export function columnSize(open: boolean, openValue: string, closedValue = '36px'): string {
  return open ? openValue : closedValue
}
