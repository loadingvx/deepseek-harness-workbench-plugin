# 右键菜单（Context Menu）开发原理与机制

> 目的：记录 dsh-workbench-plugin 中「右键菜单」从触发、定位、渲染到分发的完整机制，
> 以文件树（FileTree / TreeContextMenu）为基线，并说明 DevTools 网络面板与终端复用的同一套模式。
> 后续新增右键菜单时，直接照此文档做，不用重新分析。

## 1. 总体架构

右键菜单在插件里不是某个全局组件，而是一个**状态驱动的临时浮层**：

1. **触发**：在目标区域的 `onContextMenu`（React 合成事件）里 `preventDefault()`，
   记录鼠标坐标 `{ x: clientX, y: clientY }` 与目标上下文（target），存入 React state；
2. **渲染**：state 非空时，在目标组件 JSX 末尾渲染一个浮层菜单组件（portal 或普通 fixed 定位），
   同时渲染一个全屏透明 backdrop 用于「点击外部关闭」；
3. **定位**：菜单挂载后 `useLayoutEffect` 读取自身 `getBoundingClientRect()`，
   把 `left/top` 夹在视口内（防止溢出），并配合 `max-height` 滚动；
4. **交互**：每个菜单项是一个 `role="menuitem"` 的 `<button>`，点击后调用父组件传入的
   回调（通常先 `closeCtx()` 再执行业务动作）；Esc 关闭、点击 backdrop 关闭、
   菜单自身 `onContextMenu` 被拦截避免套娃；
5. **清理**：执行完动作或关闭后把 state 置 `null`。

### 1.1 为什么不用原生右键菜单

- 需要与工作台既有命令/剪贴板/会话能力联动（复制路径、复制为 curl、添加到会话）；
- 需要 `disabled`、危险项（`data-danger` 红色）、图标、hint 等自定义表现；
- 原生 `contextmenu` 在 iframe（BrowserView）等场景会被浏览器策略吞掉。

### 1.2 与「工具条下拉菜单」的区别

文件树还有一类「按钮下拉菜单」（编辑器选择 `css.menu` / `menuBackdrop`），
它由 IconButton 的 `active` 状态驱动，定位在按钮下方，不是跟随鼠标。右键菜单走鼠标坐标，二者不混用。

## 2. 基线实现拆解：文件树

### 2.1 文件：`src/client/workbench/TreeContextMenu.tsx`

- 导出类型 `TreeMenuTarget`：`{ scope: 'root' }` 或 `{ scope: 'entry'; path; name; kind: 'file' | 'directory' }`。
  这是「菜单对谁生效」的唯一数据来源，所有菜单项的可用性（`disabled`）与动作参数都由它推导；
- 组件只负责**展示与定位**，所有动作都是 props 回调（`onOpen/onCopy/onPaste/...`），
  组件内部不触碰业务逻辑 —— 这样菜单可以被单测、被其他区域复用；
- `MenuItem` 子组件：`<button role="menuitem">` + 图标 + 文案 + 可选 hint + `data-danger`；
- 定位：`useLayoutEffect` 依赖 `[x, y, editorsReady, editors.length, canPaste]`，每次菜单内容变化都重新夹取坐标；
- 关闭：backdrop `onMouseDown={onClose}`（用 mousedown 而非 click，避免和菜单项的 click 竞争）；
  菜单内部 `onMouseDown` 要 `stopPropagation`，防止点到 backdrop 把自己关了；
  Esc 用 capture 阶段 `keydown` 监听（保证在输入框聚焦时也能关）。

### 2.2 宿主：`src/client/workbench/FileTree.tsx`

- state：`const [ctxMenu, setCtxMenu] = useState<{ x; y; target: TreeMenuTarget } | null>(null)`；
- 触发：`handleTreeContextMenu` 挂在 `<nav onContextMenu>` 上：
  - 先排除输入框/对话框（`closest('input, textarea, [role="alertdialog"]')`）；
  - 用 `origin.closest('[data-tree-path]')` 判断是否命中条目行（行上挂了 `data-tree-path / data-tree-name / data-tree-kind` 属性）；
  - 命中条目 → `openCtxMenu(event, { scope: 'entry', ... })`；
  - 未命中但点在 `.body` 内 → 根目录菜单 `{ scope: 'root' }`；
- `openCtxMenu`：`preventDefault() + stopPropagation()`，记录坐标，顺手懒加载外部编辑器列表；
- 渲染：JSX 末尾 `{ctxMenu !== null ? <TreeContextMenu ... onClose={closeCtx} /> : null}`；
- 每个动作回调里第一步几乎都是 `closeCtx()`（如 `onCopyRelPath`、`onDelete`），
  保证菜单先消失再执行，避免重复点击。

### 2.3 样式：`FileTree.module.css` 中的 `.ctx*` 系列

| 类 | 作用 |
| --- | --- |
| `.ctxBackdrop` | `position: fixed; inset: 0; z-index: 30`，点击即关 |
| `.ctxMenu` | `position: fixed; z-index: 31; min-width: 228px; max-height: min(70vh, ...)`，圆角+阴影 |
| `.ctxItem` | 行内 flex：图标 + 文案，hover 高亮，`:disabled` 半透明 |
| `.ctxItem[data-danger]` | 危险项红色 |
| `.ctxSep` | 分隔线 |
| `.ctxHint` | 菜单底部提示文案 |

层级约定：**backdrop 30 / 菜单 31**，高于工作台自身浮层。

## 3. 通用化：新增右键菜单的最小步骤（本需求已落地）

本需求新增了两处右键菜单（DevTools 网络面板、终端），并抽取了通用组件：

- `src/client/workbench/ContextMenu.tsx` + `ContextMenu.module.css`：
  把「backdrop + 浮层 + 定位 + Esc/点击关闭 + MenuItem」抽成通用组件 `ContextMenu`；
  菜单项通过 props 数组声明：`{ id, icon?, label, hint?, disabled?, danger?, onClick? }`，中间可插分隔线；
- 各区域只需：state 记录 `{ x, y }`（+ 业务 target）→ 在行/容器 `onContextMenu` 里 preventDefault 并 setState → 渲染 `<ContextMenu items={...} />`。

### 3.1 新增菜单项时的纪律

1. **文案一律走 t()**，zh/en 双份（见 `src/client/locales.ts`，注意两处字典都要加）；
2. 菜单项点击回调要**同步关闭菜单**（避免菜单残留遮挡）；
3. 复制类动作统一走 `navigator.clipboard.writeText` + 降级 textarea 方案（见 FileTree `copyPath`）；
4. 会改变工作区/终端状态的动作，先做 busy 防重入（`disabled`）；
5. 危险动作加 `danger` 样式并二次确认（文件树删除用 dialog，终端中断不二次确认）。

## 4. 位置计算与边界

- 菜单定位在 `useLayoutEffect` 中做，避免闪烁；
- 夹取公式：`left = Math.max(8, Math.min(x, innerWidth - menuWidth - 8))`，top 同理；
- `max-height` + `overflow-y: auto` 处理小屏；
- 若菜单内容异步变化（如编辑器列表加载完），把变化量放进定位 effect 的依赖数组，重新夹取。

## 5. 与「添加到会话」的联动

右键菜单里的「添加到会话」类动作并不直接操作原生会话 DOM，而是：

1. 菜单回调里调用 Workbench 注入的回调（如 `onAddNetToChat(snapshot)` / `onAddTextToChat(text)`）；
2. Workbench 内部用 `[data-composer-seat]` 找到输入框，读取 `selectionStart/selectionEnd` 与
   实时 `draftRev`，组装 span；
3. 通过 `slash/input-insert-reference`（胶囊）或 `slash/input-insert-text`（纯文本）bail 事件
   写入官方输入框 —— 详见《拖拽与会话交互机制》文档。

---

参见：
- 拖拽到会话窗口（含胶囊）与注意力机制：`docs/drag-drop-attention-mechanism.md`
- 文件树实现：`src/client/workbench/FileTree.tsx`、`src/client/workbench/TreeContextMenu.tsx`
- 通用菜单组件：`src/client/workbench/ContextMenu.tsx`