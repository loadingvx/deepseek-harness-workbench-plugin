# dsh-workbench-plugin

DeepSeek Harness Web UI 的 **工作台界面插件**：给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加上 Cursor 风格的三栏工作台。

安装后，在「对话」标题栏点 **工作台**，页面会变成：

| 左栏 | 中栏 | 右栏 |
| --- | --- | --- |
| 原来的 Agent 对话（选模型、发消息、批准都还在这里） | 文件编辑器 | 文件树 / 源代码管理（Git） |

不改 harness 源码，以 Cordis 插件形式加载，装进 `web` profile 即可。

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 三栏工作台 | 对话、编辑器、右侧栏可分别显示/收起；栏宽可拖，双击恢复默认。正在对话时会自动展开聊天栏 |
| 文件编辑器 | 多标签打开文件，支持编辑、保存；未保存会提示。点右侧文件或 Git 差异都会在这里打开 |
| 文件树 | 浏览当前工作区目录，展开文件夹、打开文件；大目录会截断并提示继续往下点 |
| 源代码管理 | 右侧可切到 Git：已暂存 / 未暂存 / 未跟踪、提交图 GRAPH、当前分支。可暂存后提交，或一键提交全部 |
| 模型工具 | 聊天时模型可调用 `git_status`、`git_diff`、`git_log`、`git_branch`、`git_commit`；提交需要你在界面上点「允许」 |
| 多语言 | 内置中文 / English 界面文案 |

当前版本暂不提供 push / pull / fetch / merge / rebase / 冲突解决 / stash / 远程操作。AI 根据 diff 生成提交说明的入口也暂时隐藏。

## 环境要求

- **Node.js** `^22.19.0 || >=24.0.0`
- **DeepSeek Harness** 已安装，能启动 `dsh web`（默认 http://127.0.0.1:3080）
- **git** 命令行（右侧「源代码管理」和模型 Git 工具会用到）
- 开发环境还需要 [mise](https://mise.jdx.dev/)（钉死 Node 24.15.0 与 pnpm 11.7.0）

## 安装

### 方式一：从 npm registry 安装（发布后）

```bash
dsh plugin --profile web add dsh-workbench-plugin
```

安装完成后 **重启** 正在运行的 `dsh web`（只安装不重启，旧进程看不到本插件），然后打开浏览器 http://127.0.0.1:3080：

1. 打开 **「对话」**
2. 标题栏右侧出现 **工作台** 图标，点进去就是三栏界面

### 方式二：本地路径安装（未发布 / 联调）

```bash
dsh plugin --profile web add /path/to/deepseek-harness-workbench-plugin
dsh --profile web --dump-config   # 应能看到 # == dsh-workbench-plugin
dsh web
```

### 端口冲突

若 3080 已被占用：

```bash
dsh --profile web --port 3081
```

## 使用说明

1. 先在左侧打开一个 **本地工作区目录**。要用 Git 面板和提交，请打开 **Git 仓库根目录**（普通文件夹不会被自动 `git init`）。
2. 打开一个已有对话（空白会话先随便发一句，或切到「对话」），再点标题栏 **「工作台」**。
3. 聊天还是原来的「对话」：选模型、选目的、发消息、批准都在左栏。右侧用图标在 **文件** 和 **源代码管理** 之间切换；点文件或 diff 会在中间编辑器打开。各栏可收起。
4. 在源代码管理里：顶部是当前分支；下面是 **更改** 和可折叠、可拖高的 **GRAPH**。`Ctrl+Enter` 提交；没有暂存时点提交会提交全部更改。
5. 和模型对话时，它可以使用上面的 Git 工具。**提交**需要你在界面上点允许。

如果要提交代码，请先配置 git 身份（只需一次）：

```bash
git config --global user.name "你的名字"
git config --global user.email "you@example.com"
```

## 开发

### 一键准备开发环境

```bash
bash devops/setup.sh
```

用 mise 钉死 Node 24.15.0 与 pnpm 11.7.0，并安装依赖。

### 构建并装进 Web

```bash
bash devops/dev.sh
```

脚本会执行构建，然后把插件注册到 `web` profile 并提示启动命令。改代码后重新执行本脚本（或 `bash devops/build.sh`）再刷新页面。

只构建：`bash devops/build.sh` ｜ 只跑测试：`bash devops/test.sh` ｜ 等价命令：`pnpm run build` / `pnpm test`（vitest）。

### 架构速览

- `src/index.ts` — Host 半区（Node）：工作区文件系统、Git 服务、`/git` JSON API、模型工具注册
- `src/client/index.ts` — Client 半区（浏览器）：工作台三栏 UI、Git 工具卡片、多语言文案
- `cordis.patch.yml` — 插件装配补丁：Host 半区插入 `dsh-web-app` 之后，Client 半区由 dsh 客户端自动发现

## 发布 npm 包

构建产物已通过 `package.json` 的 `files` 白名单包含：`lib/index.js`（Host）、`lib/client.js`（浏览器）、`cordis.patch.yml`（装配补丁）。

```bash
# 1. 本地验证
pnpm run build && pnpm test

# 2. 发布
npm login
npm publish

# 3. 使用方安装
dsh plugin --profile web add dsh-workbench-plugin
```

> 注意：`prepare` 脚本会在 `npm install` / `pnpm add` 安装本包时自动执行 `tsdown` 构建，保证从 git 仓库直接安装（`dsh plugin add <git-url>`）也能拿到完整产物。

## License

MIT
