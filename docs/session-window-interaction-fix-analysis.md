# 「添加到会话」失效问题：根因与解决方案

> 背景：为 DevTools 网络面板与终端新增「添加到会话」功能后，实测点击无反应、会话框不出现胶囊；
> 排查发现这不是新功能的逻辑错误，而是一个**更早引入的回归**：插件 `inject` 声明丢失了 `sessions`，
> 导致所有依赖 `ctx.sessions` 的能力（含早已上线的文件树拖拽胶囊）在运行时直接抛异常。

## 1. 现象

- 终端「添加到chat」按钮：可见但点击无任何反应，会话框不出现胶囊；
- DevTools 网络面板右键「添加到会话」：无效，会话框不出现胶囊；
- 表面上看是新功能（net-ref / term-ref）写坏了，实则是共用通道整体失效。

## 2. 根因

### 2.1 一句话结论

`src/client/index.ts` 的 `export const inject = ['slots', 'locale', 'inputTriggers']`
**缺少 `'sessions'`**。cordis 上下文在访问未 inject 的服务属性时直接抛错：

```text
Error: cannot get property "sessions" without inject
```

`ctx.sessions` 一抛异常，`scopedOf(sessionId)`（`ctx.sessions.scope(id)`）就无法返回会话作用域上下文，
`insertChip` / `insertText` 全部提前 return false / 抛异常 —— 胶囊永远不会写进输入框。

### 2.2 为什么文件树拖拽以前是好的

git 历史：
- `d761948`（文件引用胶囊上线时）：`inject = ['slots', 'locale', 'inputTriggers', 'sessions']` —— 当时可用；
- 后来某次重构把 `'sessions'` 从 inject 里删掉了，文件树拖拽与一切 `ctx.sessions` 访问从此静默失效。

### 2.3 为什么难发现

- 客户端 `insertChip` 的单元测试用**假 ctx**（mock `sessions.scope`），永远测不到真实 cordis 注入缺失；
- 机器层集成测试（真实 harness `InputMachine`）只证明「reference 形状合法、CAS 逻辑正确」，不涉及插件 ctx 注入；
- 运行期异常被 onClick 吞掉，界面只表现为「没反应」，无任何可见报错。

## 3. 定位方法（可复用的调试套路）

用无头浏览器 + CDP 对运行中的 GUI 做端到端验证，并抓取 console：

1. 启动 chrome-headless-shell（`--remote-debugging-port`），打开 `http://127.0.0.1:3080`；
2. 页面内合成 `DragEvent`（`dragover` + `drop`，`DataTransfer` 里写 `application/x-dsh-net-ref`），
   直接投到 `[data-composer-seat]` 上；
3. 监听 CDP `Runtime.consoleAPICalled` / `Runtime.exceptionThrown`：
   - `marked=true`（dragover 命中）说明 window 级拖放监听与自定义 MIME 判定正常；
   - 捕获到 `cannot get property "sessions" without inject` 即锁定根因。

（测试脚本模式见 `tests/net-ref-machine.spec.ts` 与临时脚本 `/tmp/cdp-drop*.mjs`。）

## 4. 解决方案

### 4.1 核心修复（一行）

```ts
// src/client/index.ts
export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']
```

把 `'sessions'` 加回 inject。此后 `ctx.sessions.scope(id)` 返回会话作用域上下文，
`slash/input-insert-reference` / `slash/input-insert-text` 的 bail 事件能送达输入机，胶囊/文本正常写入。

### 4.2 终端按钮点击失效的第二个根因（独立于注入）

即使注入修好，终端「添加到chat」按钮仍可能点不动：**点击按钮会夺走焦点 → xterm 失焦清空选区 →
React 重渲染后按钮 onClick 闭包里的 `selection` 已是 null → 点击被吞**。

修复：
1. 按钮 `onMouseDown` 上 `event.preventDefault()`，阻止按钮抢焦点，选区在 click 时仍然存活；
2. 点击处理改为**直接从 xterm 实时读取** `term.getSelection()`（兜底用 state），不再依赖可能过期的 state。

### 4.3 终端内容改为与文件/网络一致的胶囊机制

按既有机制镜像新增 `workbench-term` 胶囊源（`src/shared/term-ref.ts` + `src/client/workbench/term-ref-client.ts`）：
- 选中内容 / 最近输出 → `slash/input-insert-reference` 铸成 U+FFFC 胶囊；
- 胶囊标签取内容首行（截断），提交时 serialize 还原为完整终端文本。

## 5. 验证

- 单测：`tests/browser-net-ref.spec.ts`、`tests/term-ref.spec.ts`、`tests/net-ref-machine.spec.ts`；
- 全量：`pnpm test`（72 文件 / 595 用例全过）；`pnpm run build` 通过；
- 端到端（无头 CDP）：合成 net-ref drop 后，输入框 value 出现 `\uFFFC` 且
  `[data-decoration="chip"]` 渲染出 `curl -X POST 'https://…'` 胶囊。

## 6. 防止再犯

- 凡在客户端访问 `ctx.sessions` / `ctx.scope`，必须确认 `inject` 数组包含 `'sessions'`；
- 涉及「写入会话输入框」的功能，验收标准应包含一次真实运行时的端到端冒烟（无头 drop 测试）；
- 相关机制备忘已沉淀为 skill：`.cursor/skills/session-window-interaction/SKILL.md`。
## 7. 追加：胶囊内容富化（第二轮反馈）

功能恢复后，按反馈把各胶囊的「模型可见内容」做厚，让 agent 拿到即能定位问题：

### 7.1 DevTools 网络请求 → 完整 curl

- 注入脚本（`browser-inspect-script.ts`）的 XHR/fetch 钩子新增采集：
  - XHR：包装 `setRequestHeader` 记录请求头、`send` 记录 body；
  - fetch：读 `init.headers`（Headers / 数组 / 对象）与 `init.body`（字符串/Blob/FormData 等，best-effort 转文本）；
  - 每个 net entry 附带 `requestHeaders`（≤20 条）、`postData`（≤2000 字符）、`pageUrl`（来源页面地址栏 URL）；
- 归一化（`browser-devtools.ts`）：头值经 `redactSecrets` 脱敏 + 截断（值 ≤300），body 脱敏 + 截断，丢弃 `:method` 等伪头；
- `buildCurlCommand` 增补 `-H 'Name: value'` 与 `--data-raw '...'`（Windows 用 cmd 引号规则，内嵌双引号翻倍）；
- `serializeNetRef` 输出完整 curl，另加 `# 来源页面: <pageUrl>` 注释；
- 右键「复制为 curl（Linux/Windows）」与「添加到会话」、拖拽载荷全部走同一完整 snapshot；
  拖拽读取端必须用 shared `normalizeNetRefSnapshot`，不能手写只读 method/url 的简化版（否则 headers/body 丢失）。

### 7.2 终端内容 → 附 pwd/shell 上下文

- `TermRefSnapshot` 增加 `context`（`pwd: … · shell: …`），由 TerminalView 的 `cwd`/`shell` 状态实时拼装；
- `serializeTermRef` 输出 `【终端内容】pwd: … · shell: …` + 分隔线 + 原文。

### 7.3 浏览器元素 → 地址栏URL / 路由前置

- `serializeBrowserEl` 把「地址栏URL」「路由」（path+search）提到最前，帮 agent 对齐前端路由与源码文件；
- 胶囊标签改为 `tag#id` / `tag.class`（DevTools 风格），不再只有裸 `a`/`div`。

### 7.4 终端按钮体验

- hover 不再换背景（深色终端上背景突变像按钮消失），改为 `filter: brightness(1.06)` 微调；
- 按钮整体改为中性设计系统按钮（border-l2 + bg-base + label-primary，参考 Git 页 dialogCancel），不再是亮色胶囊。

## 8. 相关文件索引

- 注入脚本：`src/shared/browser-inspect-script.ts`
- 网络条目类型/归一化：`src/shared/browser-devtools.ts`
- 网络胶囊 + curl 构造：`src/shared/browser-net-ref.ts`、`src/client/workbench/net-ref-client.ts`
- 终端胶囊：`src/shared/term-ref.ts`、`src/client/workbench/term-ref-client.ts`
- 浏览器元素胶囊：`src/shared/browser-el.ts`
- 交互接线：`src/client/workbench/Workbench.tsx`、`DevToolsPanel.tsx`、`TerminalView.tsx`