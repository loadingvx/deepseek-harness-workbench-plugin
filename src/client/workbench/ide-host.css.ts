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
  grid-template-rows: auto minmax(0, 1fr) auto;
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
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
[data-git-ide][data-git-chat=off] > :not([data-conversation-scroll]):not([data-git-ide-panel]){
  display: none !important;
}
[data-git-ide] > [data-conversation-scroll]{
  grid-column: 1;
  grid-row: 2 / -1;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 100%;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
/* Blank new-session hero: keep the composer centered in the chat column. */
[data-git-ide][data-phase=hero] > [data-conversation-scroll]{
  justify-content: center;
}
[data-git-ide][data-git-chat=off] > [data-conversation-scroll]{
  display: none !important;
}
[data-git-ide-panel=editor],
[data-git-ide-panel=side],
[data-git-ide-panel=rail-side],
[data-git-ide-panel=rail-editor]{
  position: relative;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
}
[data-git-ide-panel=editor],
[data-git-ide-panel=rail-editor]{
  grid-column: 2;
  grid-row: 1 / 3;
}
[data-git-ide-panel=side],
[data-git-ide-panel=rail-side]{
  grid-column: 3;
  grid-row: 1 / 3;
}
/* Editor-only bottom chrome: the side column keeps full height beside it. */
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=side],
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=rail-side]{
  grid-row: 1 / -1;
}
[data-git-ide-panel=rail-chat]{ grid-column: 1; grid-row: 2 / -1; }
/* Full-height column sashes sit on the grid so they still work over the
   bottom terminal and when the editor/side is a 36px rail. */
[data-git-ide-panel=sash-chat],
[data-git-ide-panel=sash-side]{
  position: relative;
  z-index: 8;
  width: 5px;
  min-width: 5px;
  margin-left: -2px;
  align-self: stretch;
  overflow: visible;
}
[data-git-ide-panel=sash-chat]{
  grid-column: 2;
  grid-row: 1 / -1;
  justify-self: start;
}
[data-git-ide-panel=sash-side]{
  grid-column: 3;
  grid-row: 1 / -1;
  justify-self: start;
}
/* Terminal + status bar share one bottom strip so a leftover grid row cannot sit empty between them. */
[data-git-ide-panel=bottom]{
  grid-column: 2 / -1;
  grid-row: 3;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-git-ide][data-git-bottom-span=editor] [data-git-ide-panel=bottom]{
  grid-column: 2;
}
[data-git-ide][data-git-bottom-span=right] [data-git-ide-panel=bottom]{
  grid-column: 2 / -1;
}
[data-git-ide][data-git-bottom-span=full] [data-git-ide-panel=bottom]{
  grid-column: 1 / -1;
}
[data-git-ide-panel=status]{
  flex: none;
  z-index: 5;
  min-width: 0;
  overflow: visible;
}
[data-git-ide-panel=terminal]{
  position: relative;
  flex: none;
  box-sizing: border-box;
  height: var(--git-term-h, 220px);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/* Full-width bottom chrome: chat stops above the panel so commands get the whole row. */
[data-git-ide][data-git-bottom-span=full] > [data-conversation-scroll]{
  grid-row: 2;
}
[data-git-ide][data-git-bottom-span=full] [data-git-ide-panel=rail-chat]{
  grid-row: 2;
}
/* File-tree drag over the composer: outline the input seat so dropping is obvious. */
[data-composer-seat][data-dsh-drop-target]{
  outline: 2px dashed var(--dsw-alias-accent-primary, #4c8dff);
  outline-offset: -2px;
  border-radius: 8px;
}
/* Official chip centers short names. Long names are marked in JS and
   aligned to the end so the suffix stays visible. */
[data-decoration="chip"][data-dsh-long]>span{
  justify-content:flex-end!important;
  text-align:right!important;
}
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
