# DeepSeek Harness Git 插件

给 DeepSeek Harness Web UI 增加源代码管理，以及一个 Cursor 风格的「工作台」标签：左侧 Agent 聊天、中间文件编辑器、最右侧 Git 栏。

聊天的发送/批准仍走原来的会话插件（下方输入框与「对话」标签是同一个会话）。窗口太窄时请改用「对话」标签，工作台不会硬挤三栏。

这是独立 bundle，**不改** harness 源码。安装后会出现在 `web` profile 里。

## 你需要准备什么

1. 本机已安装 [mise](https://mise.jdx.dev/)
2. 本机已安装 `git`（面板和工具都走系统 git）
3. 已能启动 DeepSeek Harness Web（`dsh web`，默认 http://127.0.0.1:3080）

## 一键准备开发环境

```bash
bash devops/setup.sh
```

会用 mise 钉死 Node 24.15.0 和 pnpm 11.7.0，再安装依赖。

## 构建并装进 Web

```bash
bash devops/dev.sh
```

然后**重启**已在跑的 `dsh web`（只安装不重启，旧进程看不到本插件）。打开页面后：

1. 打开 **「对话」** 后，标题栏右侧有工作台图标；默认会把中间栏拆成 **对话 | 编辑器 | 文件/Git**

若 3080 已被占用：

```bash
dsh --profile web --port 3081
```

只构建：

```bash
bash devops/build.sh
```

只跑测试：

```bash
bash devops/test.sh
```

## 使用说明

1. 先在左侧打开一个 **Git 仓库根目录** 作为工作区。普通文件夹不会被自动 `git init`。
2. 打开一个已有对话（空白会话先随便发一句，或切到「对话」），再点 **「工作台」**。
3. 聊天仍是原来的「对话」界面（选模型、选目的、消息、批准都在）。右侧文件和 Git 用图标小标签切换，点文件或 diff 会在中间编辑器打开。各栏可收起；正在对话时会自动展开聊天栏。
4. 和模型对话时，它可以使用 `git_status`、`git_diff`、`git_log`、`git_branch`、`git_commit`。提交需要你在界面上点允许。

提交前请先配置身份（只需一次）：

```bash
git config --global user.name "你的名字"
git config --global user.email "you@example.com"
```

## 第一期不做

push / pull / fetch / merge / rebase / 冲突解决 / stash / 远程。

## 手动安装

```bash
dsh plugin --profile web add /path/to/deepseek-harness-git-plugin
dsh --profile web --dump-config   # 应能看到 # == dsh-git-plugin
dsh web
```
