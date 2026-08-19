# 拖拽到会话窗口 与 注意力（Attention）机制

> 目的：记录「把工作台里的内容（文件、网络请求、浏览器元素）拖进/加进原生会话输入框（胶囊），
> 以及会话注意力（attention）计数与提示音」两条机制的实现原理，便于后续扩展（本需求新增了
> DevTools 网络请求拖拽 + 终端选中内容添加到会话）。

## 1. 会话输入框（composer）的官方写入通道

插件不直接操作原生 InputBar 的 DOM 值。原生输入框是一个受控组件，由 dsh 的
`ui-input-trigger` / `ui-conversation` 包管理，插件通过两类「scoped bail 事件」写入：

| 事件 | 载荷 | 效果 | 用途 |
| --- | --- | --- | --- |
| `slash/input-insert-reference` | `{ reference, span }` | 插入 U+FFFC + occurrence，InputBar 渲染成**胶囊 chip**，提交时 codec.serialize 还原为模型文本 | 文件、浏览器元素、网络请求 |
| `slash/input-insert-text` | `{ text, span }` | 在 span 处插入**普通文本**，无 occurrence | 终端选中内容、curl 命令文本 |

两个事件都是 bail（`返回 true` 才算应用成功），需要：

- **scoped context**：`ctx.sessions.scope(sessionId)` → 拿到带 `bail`/`get` 的会话上下文；
- **span CAS**：`{ start, end, draftRev }`，`draftRev` 必须来自实时草稿版本号（`props.useInput(state => state.draftRev)`），
  否则输入框状态已变（用户在拖拽途中打字）时写入被拒；
- **reference**：`{ source, ref, label, clipboardText }`，`source` 是注册在 `inputTriggers` 里的源名。

### 1.1 新增一种「胶囊源」的步骤（以网络请求 net-ref 为例）

1. **shared 层**（`src/shared/browser-net-ref.ts`）：定义 snapshot 类型（method/url）、
   标签去重（`url · 2`）、`encode/parse`（`n1:` 前缀 + URI 编码 JSON）、
   `serialize`（模型看到的文本，如 `GET https://...`）、`buildXxxReference`；
2. **client 层**（`src/client/workbench/net-ref-client.ts`）：
   - 在 `inputTriggers.registerSource({ trigger: '@', name: NET_REF_SOURCE, order, candidates: async () => [], codec })`
     注册源，让提交时 codec.serialize 能把 ref 还原成文本；
   - 暴露 `insertChip(request, t)`：拼 reference → `actx.bail(actx, 'slash/input-insert-reference', { reference, span })`；
   - 暴露 `insertText(sessionId, text, span, t)`：`actx.bail(actx, 'slash/input-insert-text', { text, span })`；
3. **接线**：`src/client/index.ts` 安装并把 API 注入 Workbench；Workbench 维护
   `existing` occurrences（`rememberOccurrences`），统一在 `fileRefDropRef` 里拿最新 sessionId / draft 长度 / draftRev；
4. **UI 层**：拖拽源在 `dragstart` 写自定义 MIME（见 §2），菜单/按钮调用 Workbench 回调（见 §3）。

## 2. 拖拽到会话窗口（文件树基线 → 网络请求扩展）

### 2.1 数据通道：自定义 DataTransfer MIME

文件树在 `dragstart` 写入三类数据（`FileTree.tsx handleDragStart`）：

| MIME | 值 | 作用 |
| --- | --- | --- |
| `application/x-dsh-path`（`FILE_REF_PATH_TYPE`） | 相对路径 | 权威数据，dragover 判定用 |
| `application/x-dsh-kind`（`FILE_REF_KIND_TYPE`） | `file` / `directory` | 芯片类型 |
| `text/plain` | 路径 | **Firefox 兜底**（dragover 阶段只能读 text/* 类型；跨文档拖拽时兜底） |

网络请求行沿用同一模式：`application/x-dsh-net-ref`（JSON：`{ method, url }`）+ `text/plain` 兜底。

### 2.2 拖放判定与高亮（Workbench 全局监听，capture 阶段）

`Workbench.tsx` 在 window 上挂 capture 阶段的 `dragover / dragleave / drop`（注意要移除）：

- `dragover`：`dragCarriesFileRef(dt)`（`dt.types.includes(FILE_REF_PATH_TYPE)`）→ 用 `composerSeatOf(event.target)`
  （`closest('[data-composer-seat]')`）找到输入框座位，`preventDefault()` 允许放置，
  并在座位元素上打 `data-dsh-drop-target` 属性 —— CSS（`ide-host.css.ts`）里给该属性画
  **虚线高亮**（2px dashed + 圆角），这就是「拖拽效果」；
- `drop`：读路径/载荷 → 组 span（`composerSelection(seat, draftLength)` 取 textarea 的 selectionStart/End）→
  `fileRefs.insertChip(...)` → 成功后聚焦 textarea；
- 网络请求扩展：dragover 判定改为「文件 ref 或 net-ref 任一类型」，drop 时按类型分发到
  `fileRefs.insertChip` 或 `netRefs.insertChip`。

### 2.3 胶囊（chip）如何变成「胶囊效果」

- InputBar 把 U+FFFC 占位符渲染成 `[data-decoration="chip"]` 元素（原生胶囊样式）；
- 插件侧 `markLongFileRefChips()` 扫描 chip，标签超过 8 字符的打 `data-dsh-long`，
  CSS 让长标签右对齐（`ide-host.css.ts`），保证后缀可见；
- 同路径重复拖入不会编号（`fileRefChipLabel` 按 ref 复用旧标签），只有**不同文件同名**才 `· 2`；
- 提交时 `codec.serialize(ref)` 输出模型可见文本（文件=相对路径、目录带尾斜杠、网络请求=Linux 风格 curl 命令，如 `curl -X POST 'https://…'`）。

### 2.4 注意事项

- **Firefox**：dragover 期间只能读取 `text/plain`，自定义类型不可见 —— 所以必须同时写 text/plain；
- 全局监听要成对 add/remove，避免插件热更新残留监听；
- 输入框处于 `adjudicating / submitting` 阶段时拒绝插入（`notifyComposer` 提示忙）；
- span 的 `draftRev` 过期会导致 bail 返回非 true，调用方要容忍失败。

## 3. 「添加到会话」回调链（右键菜单 / 终端按钮共用）

以终端选中内容 → 添加到会话为例：

1. `TerminalView` 的「添加到chat」按钮 / 右键菜单项回调 → `onAddTextToChat(text)`（Workbench 注入）；
2. `WorkbenchInner` 的 `sendTextToChat(text)`：从 `fileRefDropRef.current` 拿 sessionId/draftRev，
   找 `[data-composer-seat]` 计算插入位置，调 `netRefs.insertText({ sessionId, text, span }, t)`；
3. `net-ref-client` 内 `actx.bail(actx, 'slash/input-insert-text', ...)` 写进官方输入框；
4. 用户可直接回车提交，模型收到 `text`。

网络请求走 `onAddNetToChat(snapshot)` → `netRefs.insertChip`（§1.1），在输入框里出现胶囊（标签即 curl 命令），
提交后模型收到 Linux 风格 curl 命令（如 `curl -X POST 'https://…'`）；右键「复制为 curl」另有 Windows 变体（`curl.exe` + cmd 引号规则）。

## 4. 注意力（Attention）机制

### 4.1 数据来源与计数（纯逻辑层，可单测）

`src/client/workbench/session-monitor.ts` —— 无 React、无 DOM：

- 数据来自标准 props 的 `useSessions` / `useWorkspaces` **快照选择器 hook**（实时推送，无需轮询）；
- 顶层会话 = `!parentId && origin !== 'subagent'`（子任务不重复计入）；
- `countAttention(list, acked, archived)`：
  - 当前会话（`id === list.current`）跳过；
  - `pendingInteraction !== undefined`（等待审批/方案确认/提问）→ 计 1；
  - `isUnread`：`completed === true && id !== current && !acked.has(id)` → 计 1；
  - 已归档会话（`archivedSessionIds`）不计入，与官方分组表面一致；
- `countRunning`：顶层会话 `running` 计数（用于状态栏/面板显示）。

### 4.2 React 接线层（hook）

`src/client/workbench/useSessionMonitor.ts`：

- `useAttentionCounts`：`useSyncExternalStore` 订阅 ackVersion + 两个选择器；
  注意**窄选择器**：只订阅计数数字，`Object.is` 比对，计数不变不重渲染；
- 已读记认（ack）：页面会话期内存态（`Set<string>` + 版本号 bump + 订阅），刷新重置，
  与悬浮球的内存态一致；
- `useSessionBeep(attention, playSound)`：
  - 一次提示：开关开启且 attention 从 0 → N 时播放 1 次，清空/关开关重置；
  - 循环提醒：间隔 N 秒重播直到处理完；浏览器节流后台 setInterval，回到前台补播一次；
- 提示音：Web Audio 合成（**模块级共享 AudioContext**，避免每次 new 导致 suspended/超限）
  或用户自定义音频（HTMLAudioElement，单例防叠加）；
- 自动播放策略：监听 pointerdown/keydown/click 解锁，resume 被挡时记 pending，手势后再补播。

### 4.3 与本次需求的关系

本次新增的「添加到会话」动作会聚焦原生输入框并写入内容；用户在发送后，新会话进入 running，
完成后若用户切到别处，即被 attention 机制捕获（未读计数 + 提示音 + 状态栏角标），形成闭环。

## 5. 文件索引

- 文件 ref（基线胶囊）：`src/shared/file-ref.ts`、`src/client/workbench/file-ref-client.ts`
- 浏览器元素胶囊：`src/shared/browser-el.ts`、`src/client/workbench/browser-el-client.ts`
- 网络请求胶囊（本需求新增）：`src/shared/browser-net-ref.ts`、`src/client/workbench/net-ref-client.ts`
- 拖放接线：`src/client/workbench/Workbench.tsx`（window dragover/drop 全局监听）
- 拖放高亮 CSS：`src/client/workbench/ide-host.css.ts`（`[data-composer-seat][data-dsh-drop-target]`）
- 注意力：`src/client/workbench/session-monitor.ts`、`src/client/workbench/useSessionMonitor.ts`
- 右键菜单机制：`docs/context-menu-mechanism.md`