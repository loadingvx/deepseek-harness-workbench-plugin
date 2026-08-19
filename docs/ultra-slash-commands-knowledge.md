# Ultra Slash 命令原理与开发备忘

> 目的：记录 ultra-slash（插件命令）的完整原理——host / client 分工、DSH「/」输入触发管线、claim 机制——以及「/new 携带用户输入直接发起会话」这次改动的思路，避免下次重新分析。
>
> 结论先行：**带参数执行命令、由客户端做 UI 动作，正确姿势是「插件自己的 / source 提供 matchEnter 返回 claim，在 claim.submit 里做实际动作」**；而不是给命令加 host 端 input（claim 的 submit 闭包在 DSH ui-commands 里，插件拿不到 args，也挂不上钩）。

## 1. 总体架构（host / client 分工）

| 半边 | 位置 | 职责 |
| --- | --- | --- |
| Host | `src/host/ultra-slash/*` | 用 `ctx.commands.register` 注册 `/steer` `/new` `/skill` `/docs`；自定义命令持久化（`createCommandHub` / `loadHubFromDisk`）；设置页 HTTP API（`registerUltraSlashHttp`，前缀 `/ultra-slash`） |
| Client | `src/client/ultra-slash/*` | 在 DSH「/」菜单自建「插件命令 / Ultra Slash」分组；隐藏系统「命令」组里的同名命令；处理 `/new` 的会话切换（bridge） |
| Shared | `src/shared/ultra-slash/*` | catalog（内置命令清单、自定义命令校验）、ids、locales（zh 为 key 源头，en 必须全量覆盖）、types |

Host 端 `/new` 只回执（ack），真正的会话切换在 client 端做——这是本功能的既定分工，**不要**尝试在 host 端开会话。

## 2. DSH「/」输入触发管线（核心原理，务必记住）

### 2.1 来源注册与轮询顺序

- 所有 trigger 为 `/` 的 source 通过 `ctx.inputTriggers.registerSource(source)` 注册，组成轮询表（registration order = 菜单分组顺序 = Enter 判定顺序）。
- 输入 `/xxx` 按 Enter：`InputTriggerController.adjudicate(line)` 按注册顺序轮询每个 source 的 `matchEnter`，**第一个返回非 undefined 的胜出**；全部 undefined → 默认下沉（当作普通聊天消息发给模型）。
- **关键推论**：插件 source 注册在系统 `command` source 之后（插件后加载），所以系统 command source 先被轮询。这是 `/new` 双路径设计的基础：裸 `/new` 被 command source 先拿走，`/new <text>` 因 command source 返回 undefined 才轮到插件。

### 2.2 PickOutcome 与 claim 机制

`matchEnter` 返回：`{ claim }` / `{ insert }` / `{ text }` / `'handled'` / `undefined`。

**claim**（命令模式凭据，`ui-input-trigger` 的 `CommandClaim`）：

- `token`：如 `/new `；draft 必须 startsWith(token)，用户改动破坏前缀即释放 claim。
- `hint`：args 为空时输入框的幽灵提示。
- `submit(args, actx)`：source 提供的闭包，args 是 token 之后的文本（`InputMachine.argsAfter` 解析，保留换行）。

**Enter 判定**（`ui-conversation` 的 `InputMachine`）：

- draft 以 `/` 开头 → `onEnter` → 'adjudicating' → `adjudicate` → outcome 是 claim → `onAdjudicated` **立即** `submit(argsAfter(draft, token))`——**带参数时一次 Enter 就执行**。
- 已在 'claimed' 相再按 Enter → `onEnter` 直接 `submit(argsAfter(draft, token))`。
- 空参数 → 进入 'claimed' 相（draft 保留 token + 幽灵提示），用户补参数后再一次 Enter。

**命令注册是否带 `input` 决定行为**（`ui-commands` service 的决策表）：

- 带 `input: { hint }`（如 `/steer`）：菜单点选、Enter 都走 claim（先 `/steer ` 占位再提交）。
- 不带 `input`（`/new` 现状）：
  - 裸 Enter（`/new`）→ `runDetached` 直接执行（RPC 到 host）+ 消费 token，返回 'handled'。
  - **带参数 Enter（`/new text`）→ 返回 undefined → 下沉成普通聊天消息**。这是 `/new <text>` 以前不能工作的根因。
  - 菜单点选 → `runDetached` 执行。

### 2.3 执行通道与事件

- `remote.commands.execute(sessionId, line)`：host 执行命令；结果卡片由 host 的 `command/run` / `command/done` 生命周期事件渲染。
- `command/executed` 事件：`notifyExecuted(sessionId, name, result)` 广播，插件可订阅（目前未用）。
- host handler 只回 `{ kind: 'success' | 'error', text? }`（`SteerCommandResult`）。

## 3. 本次改动：/new 携带后面的用户输入直接发起会话

### 3.1 需求

`/new <text>`：创建新会话后，把 `<text>` 作为第一句话直接发出（发起会话）；`/new` 仍开空白会话。

### 3.2 方案与取舍

- **否决「给 /new 加 host 端 `input`」**：菜单点选会从「立即执行」变成「claim 占位」；且 claim 的 submit 闭包由 DSH `leadingClaim` 创建，插件无法挂钩、拿不到 args。
- **采用「插件 source 的 matchEnter 返回 claim」**：
  - 轮询顺序保证：裸 `/new` 由 command source 先处理（'handled'）→ bridge 开空白会话；`/new <text>` command source 返回 undefined → 插件 source claim → 带参数一次 Enter 直接 `submit`。
  - `submit(args)` 内做实际动作：`startNewSession(get, args)`。
- 桥接（`installNewSessionBridge`）保留并增强：裸 `/new` 与菜单点选仍开空白会话，现在把解析出的文本一并传给 `startNewSession`（空文本时行为不变）。

### 3.3 startNewSession 的发送时序（核心代码路径）

1. `workspaces.startSession()`：创建并导航到新会话（异步，内部 `connectWorkspace → sessions.open`）。
2. args 非空时：先记录 `before = sessions.list.getSnapshot().current`，再等 `current` 变化——优先 `list.subscribe`，无订阅时回退 30ms 轮询；3 秒超时（`NEW_SESSION_WAIT_MS`），且要求 `sessions.binding(current).session` 已可用（绑定跟随 current 存在）。
3. `session.prompt([{ type: 'text', text }], 'queue')` 发送第一句话。新会话空白 → 首轮发送是 DSH 支持的 first-send flow（`session.prompt` 里有 blankBit 处理）。

### 3.4 关键 client API 备忘

| API | 形态 | 用途 |
| --- | --- | --- |
| `ctx.get('workspaces')` | `{ startSession(workspaceId?) }` | 共享「新会话」动作；显式 workspace → 当前会话 workspace → recent workspace |
| `ctx.get('sessions')` | `{ list: { getSnapshot(): { current?: string }, subscribe? }, binding(id): { session?: { prompt(content, mode) } } }` | 定位新会话并发消息 |
| `session.prompt` | `prompt([{type:'text',text}], 'queue' | 'steer')` | queue 追加下一轮；steer 打断当前轮 |
| `leadingCommandInput(line)` | 解析 token 后的文本（保留换行） | 桥接与 matchEnter 共用 |

插件视角的类型切片都在 `src/types/harness.d.ts`（`sessions.binding`、`workspaces` 等）。`list` 未在切片里声明，用局部结构类型（`SessionsFace`）断言即可。

### 3.5 改动文件清单

- `src/client/ultra-slash/new-session.ts`：新增 `leadingCommandInput`、`newSlashMatchEnter`；`startNewSession` 支持 initialText + 首条消息发送（`sendFirstMessage` / `waitForNewSession`）；桥接签名带 initialText。
- `src/client/ultra-slash/install.ts`：插件 source 挂 `matchEnter`；桥接传参。
- `src/shared/ultra-slash/locales.ts`：更新 `new.description`；新增 `new.hint`、`new.started`。
- `tests/ultra-slash-new-session.spec.ts`：覆盖文本解析、claim submit、首条消息发送（fake sessions：startSession 翻转 current 并通知订阅者）、桥接传参。
- `README.md` / `README.zh-CN.md`：`/new` 说明同步。

## 4. 扩展指引（下次直接照做）

- **新增内置命令**：`shared/ultra-slash/catalog.ts` 的 `BUILTIN_SLASH_COMMANDS` 加一行（kind: steer / alias / session）→ `host/ultra-slash/register.ts` 的 `registerBuiltinCommands` 加注册分支 → locales 补 zh/en 键（en 必须覆盖 zh 全量，`ultra-slash-locales.spec.ts` 会校验）→ 菜单行由 `PLUGIN_SLASH_COMMANDS` 自动派生。
- **自定义命令** = `/name` → `/steer <固定文本>` 别名，存 `~/.dsh/ultra-slash/commands.json`（`$DSH_HOME` 优先），最多 40 条；校验与保留名规则在 `catalog.ts`。
- **命令执行后要做客户端 UI 动作**（切会话、开面板等）：host 只回执；client 侧要么用 bridge（裸命令路径）要么用插件 source 的 claim.submit（带参数路径）。
- **host 端想拿带参文本**：`invocation.rawInput` 就是 token 后的原文（`/steer`、别名命令都用它）。

## 5. 验证

- `pnpm test`：vitest 全量（68 个文件，572 用例）。
- `pnpm run build`（或 `bash devops/build.sh`）：tsdown 产出 `lib/index.js` 与 `lib/client.js`；**推 GitHub 前必须把这两份与源码一起提交**（市场 `github:...` 装的是仓库内容，不编译）。
