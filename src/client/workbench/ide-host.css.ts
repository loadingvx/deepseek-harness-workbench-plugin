export const IDE_STYLE_ID = 'dsh-workbench-plugin/ide-split'

/**
 * Split the conversation COLUMN (parent of the native scrollport).
 * Never change display/overflow on [data-conversation-scroll]: that node is
 * the chat scrollport, and the composer must stay position:sticky inside it.
 */
export const IDE_HOST_CSS = `
[data-git-ide]{
  display:grid !important;
  grid-template-columns: var(--git-col-chat, minmax(300px, 38%)) minmax(0, 1fr) var(--git-col-side, 280px);
  grid-template-rows: auto minmax(0, 1fr);
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden !important;
  min-width: 0 !important;
  min-height: 0 !important;
  height: 100%;
}
/* 收起编辑器：左侧对话吃掉中间空间，文件/Git 侧栏始终钉在最右侧 */
[data-git-ide][data-git-editor=off]{
  grid-template-columns: minmax(0, 1fr) 36px var(--git-col-side, 280px);
}
[data-git-ide][data-git-side=off]{
  grid-template-columns: var(--git-col-chat, minmax(300px, 38%)) minmax(0, 1fr) 36px;
}
[data-git-ide][data-git-editor=off][data-git-side=off]{
  grid-template-columns: minmax(0, 1fr) 36px 36px;
}
[data-git-ide][data-git-chat=off]{
  grid-template-columns: 36px minmax(0, 1fr) var(--git-col-side, 280px);
}
[data-git-ide][data-git-chat=off][data-git-editor=off]{
  grid-template-columns: 36px 36px var(--git-col-side, 280px);
  justify-content: end;
}
[data-git-ide][data-git-chat=off][data-git-side=off]{
  grid-template-columns: 36px minmax(0, 1fr) 36px;
}
[data-git-ide][data-git-chat=off][data-git-editor=off][data-git-side=off]{
  grid-template-columns: 36px 36px 36px;
  justify-content: end;
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
  position: relative;
  min-width: 0;
  max-width: 100%;
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
  let tag = document.querySelector(`style[data-plugin-css="${IDE_STYLE_ID}"]`)
  if (!(tag instanceof HTMLStyleElement)) {
    tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-workbench-plugin'
    tag.dataset.pluginCss = IDE_STYLE_ID
    document.head.appendChild(tag)
  }
  if (tag.textContent !== IDE_HOST_CSS) tag.textContent = IDE_HOST_CSS
}
