export const IDE_STYLE_ID = 'dsh-workbench-plugin/ide-split'

/**
 * Chat fills the host; optional legacy SideDock on the right; StatusBar spans
 * chat / side / full via data-git-bottom-span. No workbench editor or rail.
 */
export const IDE_HOST_CSS = `
[data-git-ide]{
  display:grid !important;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden !important;
  min-width: 0 !important;
  min-height: 0 !important;
  height: 100%;
}
[data-git-ide][data-git-side=on]{
  grid-template-columns: minmax(0, 1fr) var(--git-col-side, 280px);
}
[data-git-ide][data-git-chat=off]{
  grid-template-columns: 36px;
  justify-content: end;
}
[data-git-ide][data-git-chat=off][data-git-side=on]{
  grid-template-columns: 36px var(--git-col-side, 280px);
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
  grid-row: 1;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: 100%;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
[data-git-ide][data-phase=hero] > [data-conversation-scroll]{
  justify-content: center;
}
[data-git-ide][data-git-chat=off] > [data-conversation-scroll]{
  display: none !important;
}
[data-git-ide-panel=side]{
  position: relative;
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
}
[data-git-ide-panel=rail-chat]{
  grid-column: 1;
  grid-row: 1 / -1;
}
[data-git-ide-panel=sash-side]{
  position: relative;
  z-index: 8;
  width: 5px;
  min-width: 5px;
  margin-left: -2px;
  grid-column: 2;
  grid-row: 1 / -1;
  justify-self: start;
  align-self: stretch;
  overflow: visible;
}
[data-git-ide-panel=bottom]{
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  grid-row: 2;
  grid-column: 1 / -1;
}
[data-git-ide][data-git-bottom-span=chat] [data-git-ide-panel=bottom]{
  grid-column: 1;
}
[data-git-ide][data-git-bottom-span=side][data-git-side=on] [data-git-ide-panel=bottom]{
  grid-column: 2;
}
[data-git-ide][data-git-bottom-span=full] [data-git-ide-panel=bottom]{
  grid-column: 1 / -1;
}
/* Side-only status: chat stays full height; SideDock sits above the bar. */
[data-git-ide][data-git-bottom-span=side][data-git-side=on] > [data-conversation-scroll]{
  grid-row: 1 / -1;
}
[data-git-ide][data-git-bottom-span=chat][data-git-side=on] [data-git-ide-panel=side]{
  grid-row: 1 / -1;
}
[data-git-ide-panel=status]{
  flex: none;
  z-index: 5;
  min-width: 0;
  overflow: visible;
}
[data-composer-seat][data-dsh-drop-target]{
  outline: 2px dashed var(--dsw-alias-accent-primary, #4c8dff);
  outline-offset: -2px;
  border-radius: 8px;
}
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
