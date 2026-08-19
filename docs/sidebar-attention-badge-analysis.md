# 左侧原生会话列表 · 提醒铃铛与角标方案分析

> 目的：记录「去掉插件 SessionsPanel 的 needs-attention 列表，改在系统原生左侧会话列表加铃铛/角标」这一需求的分析结论，以及左侧原生菜单（sidebar）扩展点架构，避免下次重新分析。
>
> 结论先行：**不改 deepseek-harness 源码，无法优雅地在原生会话行内注入铃铛图标、也无法在工程 folder 行右上角加数字角标**。原因与替代方案见下文。

## 1. 需求背景

插件（dsh-workbench-plugin）自带「全局会话监控」面板（SessionsPanel），当前分三个区块：需要你注意（attention）→ 运行中（running）→ 其他会话（others，已删除）。用户希望：

1. 去掉「需要你注意」列表区块（与原生列表信息重复）；
2. 保留 attention session 的提醒功能（提示音、循环提醒、计数角标）；
3. 改为在**系统原生左侧会话列表**上直接体现：会话行开头（与工程 folder 图标对齐位置）显示铃铛图标；对应工程 folder 图标的右上角显示圆圈数字。

问题：**不改 harness 源码，能否通过插件实现？**

## 2. 左侧原生菜单扩展点架构（sidebar slot 树）

数据源：`deepseek-harness/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` + `packages/client/ui-sidebar` + `packages/client/ui-workspace`。

### 2.1 slot 一览

| Slot | kind | 占用者 | 插件可否注入 |
| --- | --- | --- | --- |
| `sidebar` | single | client-ui-sidebar SidebarRoot | ❌ 注册即替换整个导航列（`replaceRisk: shadows-shipped-ui`） |
| `sidebar.workspaces` | single | client-ui-workspace WorkspaceBrowser | ❌ 注册即替换整个浏览区（含列表，等于重写） |
| `sidebar.workspaces.directoryFlow` | single | 目录选择流程包 | ✅ 仅目录选择交互，与行渲染无关 |
| `sidebar.settings` | single | client-ui-settings-general SettingsRoot | ❌ 替换设置区 |
| `sidebar.footer.action` | list | 侧边栏底部操作 | ✅ 可新增底部按钮（但不在行内） |

### 2.2 关键结论：`sidebar.workspaces` 是 single，且无行级子 slot

- `sidebar` 声明（ui-sidebar/src/client/contract/slots.ts:24）：`'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }`。
- `sidebar.workspaces` 的唯一子 slot 是 `sidebar.workspaces.directoryFlow`（ui-workspace/src/client/contract/slots.ts:58，`kind: 'single'`）。
- WorkspaceBrowser 注册（ui-workspace/src/client/index.ts:110）只声明了 `directoryFlow` 一个 children。
- **行组件（`SessionNodeItem` / `ProjectRowItem`，ui-workspace/src/client/rows/Rows.tsx）是纯展示组件：无 children 槽、无行级 slot、无注入点。** 会话行结构 = 状态点 slot + title + time + 行操作菜单；工程行 = folder 图标 + chevron + title + 行操作菜单。
- 行 DOM 元素仅有 `role="treeitem"` / `aria-selected` / `aria-label` 等属性，**没有 `data-session-id` 之类的稳定标识**，CSS Modules 类名经编译也不稳定 —— 依赖 DOM 选择器做注入既脆弱又违反架构（`ctx.slots` 是唯一组合路径）。

### 2.3 数据可达性（插件能拿到什么）

插件已通过标准 props 拿到全部所需数据，**数据不是问题，渲染注入才是问题**：

- `useSessions` → `SessionListLike`：`ids` / `byId`（含 `running`、`pendingInteraction`、`completed`、`current`、`updatedAt`）；
- `useWorkspaces` → `WorkspaceListLike`：`items`（`workspaceId`/path/title/`sessionIds`）、`archivedSessionIds`。

插件的 SessionsPanel / TabBadge / 提示音正是靠这两个 hook 实现的，**与原生列表渲染完全解耦** —— 因此「数据驱动提醒」早已成立，不依赖原生行渲染。

### 2.4 原生行已有 attention 可视化（重要事实）

原生行本身已经通过状态点表达 attention（Rows.tsx `sessionStatuses()`）：

- `pendingInteraction`（approval / plan-review / question）→ `warning` 橙点，hover 显示「等待审批 / 等待方案确认 / 等待你的输入」；
- `running` → `ongoing` 动点，hover 显示「运行中」；
- `completed` → `done` 绿点，hover 显示「完成」。

即：**"哪个会话需要你注意"在原生列表上已经可见**，插件面板的 attention 列表确实与之重复。

## 3. 问题原因（为什么不能不改源码实现）

1. **无行级组合路径**：slot 系统是唯一 UI 组合机制（`slots.register`），而 `sidebar.workspaces` 的子树由 ui-workspace 包内部闭包实现，行组件不渲染任何子 slot，也没有 children 插槽。外部插件无法触及行内 DOM 渲染。
2. **single slot 独占**：`sidebar.workspaces` 是 single，插件注册它会**替换**整个浏览区而不是"添加铃铛"。重写 WorkspaceBrowser（含分组/排序/搜索/拖拽/菜单/对话框）工程量巨大且必然与官方行为漂移，不算"优雅"。
3. **DOM hack 不可取**：行无稳定 id、CSS Modules 类名不稳定、React 重渲染会覆盖 DOM 操作；依赖 MutationObserver + 选择器注入属于脆弱的影子实现，与插件架构（一切经 slot/props）相悖。

## 4. 解决方案（三个层次）

### 方案 A（推荐 · 纯插件，不改 harness）

保留提醒能力，去掉重复列表：

- ✅ 删除 SessionsPanel 的「需要你注意」区块（保留「运行中」或整个面板按需精简）；
- ✅ 保留提示音 + 循环提醒 + 自定义铃声（`useSessionBeep` / SoundSettings，纯插件数据驱动，不依赖原生行）；
- ✅ 保留插件自己的标签角标 TabBadge（sessions 标签右上角数字，已有，`TabBadge.tsx`）；
- ✅ 原生列表的 attention 由原生状态点承担（见 2.4），无需插件额外渲染。

效果：提醒功能完整（声音 + 角标 + 原生状态点），信息零重复，零 harness 改动。**这是"优雅"且可行的实现。**

### 方案 B（要"原生行内铃铛 + folder 角标数字" → 必须改 harness）

给 ui-workspace 增加行级扩展点（属于 harness 源码改动，可提 PR）：

- 在 `SessionNodeItem` 状态点 slot 旁增加一个可渲染子 slot（如 `sidebar.workspaces.sessionRow` 或行级 `children` 槽），插件注册铃铛图标；
- 在 `ProjectRowItem` folder 图标上增加角标 slot 或 owner-prop，插件注册数字角标（统计该 workspace 组下 attention 会话数）；
- 或至少给行 DOM 增加 `data-session-id` / `data-workspace-id` 稳定属性，供插件做声明式增强（仍是 hack，但有了稳定锚点）。

前提：需要修改 deepseek-harness（`packages/client/ui-workspace`），并保持其 slot 声明/类型链完整。

### 方案 C（不改源码的兜底 hack · 不推荐）

MutationObserver 监听 `.sessionRow` / `.projectRow`，按行内文本/aria-label 匹配会话并插入铃铛/角标。缺点：无稳定 id、类名编译不稳定、React 重渲染覆盖、无类型与测试保障 —— 不建议。

## 5. 结论

| 需求 | 不改 harness 源码 | 优雅程度 |
| --- | --- | --- |
| 去掉插件面板 attention 列表 | ✅ 可 | 高 |
| 保留声音/循环提醒 | ✅ 可 | 高 |
| 插件标签角标数字 | ✅ 可（已有） | 高 |
| 原生行内铃铛图标 + folder 角标数字 | ❌ 不可 | ——（需方案 B 改 harness） |
| 原生行 attention 可视化 | 原生已有状态点 | 高 |

**推荐落地**：方案 A —— 删插件 attention 列表，提醒功能由「提示音 + TabBadge 角标 + 原生状态点」三方承担；若坚持铃铛/角标上原生行，走方案 B 向 harness 提扩展点 PR。

## 6. 相关代码索引（下次免查）

- 插件 SessionsPanel：`src/client/workbench/SessionsPanel.tsx`
- 插件提醒 hook：`src/client/workbench/useSessionMonitor.ts`（`useSessionBeep`）、`src/client/workbench/SoundSettings.tsx`
- 插件角标：`src/client/workbench/TabBadge.tsx`、`SideDock.tsx`
- harness sidebar 声明：`packages/client/ui-sidebar/src/client/contract/slots.ts`、`SidebarRoot.tsx`
- harness 浏览区注册：`packages/client/ui-workspace/src/client/index.ts`（`ctx.slots.inject('sidebar.workspaces', ...)`）
- harness 行组件：`packages/client/ui-workspace/src/client/rows/Rows.tsx`（`SessionNodeItem` / `ProjectRowItem` / `sessionStatuses`）
- harness slot 目录：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`

