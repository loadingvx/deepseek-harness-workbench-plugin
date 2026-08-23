---
name: session-window-interaction
description: 把工作台内容（文件、网络请求、终端选中内容等）写入原生会话输入框并显示为胶囊（attention 胶囊）的机制与踩坑。当任务涉及「添加到会话 / add to chat / 拖拽到会话窗口 / 胶囊 / chip / 会话输入框插入 / slash/input-insert-reference / ctx.sessions」时触发。
---

# 会话窗口交互机制（attention 胶囊）

把插件里的内容（文件树节点、DevTools 网络请求、浏览器元素、终端选中内容）变成原生会话输入框里的
**胶囊**（chip），提交后模型收到展开文本。这是插件与「会话窗口」交互的唯一官方通道。

## 0. 铁律：inject 必须包含 sessions

`src/client/index.ts` 的 `export const inject = [...]` **必须包含 sessions**：

```ts
export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']
```

一旦缺失，`ctx.sessions.scope(id)` 在运行时抛 `Error: cannot get property "sessions" without inject`，
所有胶囊插入静默失效（点击无反应、输入框不出现胶囊）。历史教训：文件树拖拽曾因此回归，
见 `docs/session-window-interaction-fix-analysis.md`。

## 1. 官方写入通道

原生输入框是受控组件，插件不能直接改 DOM 值，只能走两条 scoped bail 事件：

| 事件 | 载荷 | 效果 |
| --- | --- | --- |
| `slash/input-insert-reference` | `{ reference, span }` | 插入 U+FFFC + occurrence，InputBar 渲染成胶囊；提交时 codec.serialize 还原文本 |
| `slash/input-insert-text` | `{ text, span }` | 插入普通文本（无胶囊；少数兜底场景用） |

- **reference**：`{ source, ref, label, clipboardText }`，source 须在 `inputTriggers.registerSource` 注册过（否则提交时无法 serialize）；
- **span CAS**：`{ start, end, draftRev }`，`draftRev` 必须等于输入机当前版本，否则事件被拒（返回非 true）；
- **phase 守卫**：`adjudicating / submitting` 阶段拒绝插入，先提示用户。

## 2. 胶囊源的标准实现（镜像既有模式）

每种内容 = 一对文件，照抄即可：

1. **shared 层**：`src/shared/<x>-ref.ts`（无 DOM、可单测）
   - 常量：`SOURCE`（如 `workbench-net`）、`TRIGGER`（`'@'`）、`DRAG_TYPE`（可选，拖拽用）；
   - `Snapshot` 类型（如 `{ method, url }` / `{ text }`）；
   - `encode/parse`（`n1:` / `t1:` 前缀 + encodeURIComponent(JSON.stringify)）；
   - `serialize`（模型看到的文本：文件=相对路径、网络=完整 curl、终端=原文+上下文）；
   - `label`（胶囊标签，短、去重 `· 2`）；
   - `buildXxxReference(snapshot, existing)`。
2. **client 层**：`src/client/workbench/<x>-ref-client.ts`
   - `installXxxRefClient(ctx)`：`ctx.effect` 里 `inputTriggers.registerSource({ trigger, name, order, candidates, onPick, codec })`（try/catch 包住，重复注册返回 noop）；
   - 暴露 `insertChip(request, t)`：`ctx.sessions.scope(sessionId)` → 校验 phase → merge existing（含 `conversationInput(actx)?.snapshot?.occurrences`）→ `buildXxxReference` → `actx.bail(actx, 'slash/input-insert-reference', { reference, span })` === true；
   - 暴露 `xxxExisting(occurrences)` 给 Workbench 记忆已用标签。
3. **接线**：`src/client/index.ts` 安装并注入 `WorkbenchInjected`；Workbench 里 `sendXxxToChat` 回调：从 `[data-composer-seat]` 找 textarea，`composerSelection` 取光标位，span 用实时 `draftRev`（`props.useInput(state => state.draftRev)`）。
4. **UI 层**：右键菜单 / 浮动按钮 / 拖拽 drop 统一调 Workbench 回调。

参考实现：`file-ref`（文件，基线）、`browser-el`（浏览器元素）、`browser-net-ref`（网络请求，拖拽+完整 curl）、`term-ref`（终端选中内容）。

## 3. 胶囊内容要带足上下文（让 agent 拿到即能定位）

- 网络请求：**完整 curl**（`-X`、`-H`、`--data-raw`）+ 来源页面路由注释（`# 来源页面: …`）；
  headers/body 由注入脚本 `browser-inspect-script.ts` 的 XHR/fetch 钩子采集（`setRequestHeader` / `init.headers` / `init.body`），
  归一化时脱敏（`redactSecrets`）+ 截断（头 ≤20 条、值 ≤300、body ≤2000）；
  **拖拽载荷必须带完整 snapshot**，读取端用 shared 层 `normalizeNetRefSnapshot`，不要手写只读 method/url 的简化版（会丢掉 headers/body）；
- 终端内容：**pwd / shell 上下文**头部（`【终端内容】pwd: … · shell: …`）+ 原文，帮助排查命令执行环境与错误来源；
- 浏览器元素：**地址栏URL + 路由**（path+search，帮 agent 对齐前端路由与源码位置）+ 标题 + 标签/id/class + XPath/CSS/JSPath + HTML；
- 胶囊标签：短且可读（浏览器元素用 `tag#id` / `tag.class`；网络请求用精简 curl；终端用首行文本）。

## 4. 拖拽到会话窗口

- 拖拽源 `dragstart` 写自定义 MIME（如 `application/x-dsh-net-ref`，JSON 载荷，完整 snapshot）+ **`text/plain` 兜底**（Firefox dragover 只能读 text/*）；
- Workbench 在 window 上挂 **capture 阶段** `dragover/dragleave/drop`（成对 add/remove）；
- dragover：判定 MIME → `composerSeatOf(event.target)`（`closest('[data-composer-seat]')`）→ `preventDefault` + 座位打 `data-dsh-drop-target`（CSS 画虚线高亮）；
- drop：读载荷 → 组 span → `insertChip` → 成功后 focus textarea。

## 5. 终端「添加到chat」按钮

- 选中内容时在选区左下角显示浮动按钮（绝对定位 + `getSelectionPosition` 换算像素；用渲染行元素 `.xterm-rows > div` 实测定位最稳）；
- **点击前必须 `onMouseDown={e => e.preventDefault()}`**：否则按钮抢焦点 → xterm 失焦清空选区 → onClick 里选区已空，按钮「死了」；
- 点击处理**直接读 `term.getSelection()`**，别依赖可能过期的 React state；
- 按钮样式用中性设计系统按钮（border-l2 + bg-base + label-primary，参考 Git 页 dialogCancel），**hover 不要换背景**（深色终端上背景一变像按钮消失，只做亮度微调 `brightness(1.06)`）。

## 6. 调试清单（端到端验证）

单测通过 ≠ 运行时可用（inject 缺失 / scope 解析 / span CAS 都是运行期问题）：

1. `grep -n "export const inject" src/client/index.ts` → 必须含 `'sessions'`；
2. 无头 CDP 冒烟：页面合成 `DragEvent`（自定义 MIME，带完整 snapshot）投到 `[data-composer-seat]`，监听 `Runtime.exceptionThrown`，断言输入框出现 `\uFFFC` 且 `[data-decoration="chip"]` 有胶囊；
3. 全量 `pnpm test` + `pnpm run build`。

## 7. 相关文档

- 根因分析：`docs/session-window-interaction-fix-analysis.md`
- 右键菜单机制：`docs/context-menu-mechanism.md`
- 拖拽与注意力机制：`docs/drag-drop-attention-mechanism.md`