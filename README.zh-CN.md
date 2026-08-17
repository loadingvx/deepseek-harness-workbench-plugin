![preview](docs/img/social-preview.jpg)

DeepSeek Harness Web UI 工作台插件。在「对话」视图中打开工作台后，对话保留在左侧；右侧新增两栏，分别承载编辑器（含语法高亮与终端）以及文件、Git 与用量。


## 目录

- [核心能力](#核心能力)
- [功能一览](#功能一览)
- [能力矩阵](#能力矩阵)
- [发行信息](#发行信息)
- [安装](#安装)
- [升级](#升级)
- [界面](#界面)
- [工作区终端](#工作区终端)
- [AI 命令助手](#ai-命令助手)
- [许可证](#许可证)

## 核心能力

1. **工作台布局**：三栏——左侧对话，中间编辑器与终端，右侧文件 / Git / 用量。新建会话即打开工作台。各栏可拖拽调宽、收成图标条、再展开。
2. **智能终端**：本机伪终端（PTY）。真正的 shell 行（含粘贴的 `$ ls`）直接执行；自然语言会翻译后打进**当前** shell。说明语句不可执行。可配置黑名单拦助手代敲的危险命令。
3. **工作区编辑器**：CodeMirror 6 语法高亮；普通 / Emacs / Vim 快捷键；Markdown 编辑 / 预览 / 分栏；图片与表格预览；Git 差异；多标签、面包屑、保存与未保存关闭确认。
4. **文件树**：浏览、筛选、隐藏文件、`.gitignore` 标记、新建 / 重命名 / 删除，以及用本机 Cursor、VS Code 等打开。
5. **Git**：状态、暂存、提交（含 AI 流式说明）、fetch / pull / push 安全拦截、分支、合并、撤销、提交图、`git init`，以及对话里的 `git_*` 工具。
6. **用量**：官方余额、本机观察消耗、本会话 Token 与上下文；可钉到左侧 Settings 上方（含收起后的缩略条）；状态栏常驻余额。
7. **状态栏**：已打开文件、余额、反馈、版本 / 升级、工作区路径、分支、改动数、编辑模式。
8. **维护与隐私**：界面内升级检查、中 / 英界面、路径和报错里的 token 脱敏。

## 功能一览

### 工作台

- 三栏布局：对话 | 编辑器 + 终端 | 文件 / Git / 用量
- 新建会话立刻打开，不必先提问
- 标题栏 **工作台** 按钮可整体开关
- 拖拽调栏宽，双击分隔条恢复默认，宽度会记住
- 对话、编辑器、右侧栏都可收成窄图标条

### 编辑器

- 多文件标签；保存；未保存标记；有改动关闭前会确认
- 关闭全部 / 其他 / 左侧 / 右侧
- 路径面包屑
- 语法高亮：JavaScript、TypeScript、JSX、TSX、JSON、HTML、CSS、Markdown、Python、XML、YAML；其余按纯文本
- 快捷键：普通 / Emacs / Vim，选择会保存；**默认 Emacs**（打字即输入，不会卡在 Vim 普通模式）
- Markdown：编辑、预览、分栏；GFM；`http(s)` 与工作区相对路径图片；[Mermaid](https://mermaid.js.org/) 11 代码块；工作区文件链接可点开；不安全链接会拦截
- 工作区 diff 与提交 diff 在编辑器标签中打开
- 图片预览：png、jpg、jpeg、gif、webp、avif、bmp、ico
- 表格预览：csv、tsv、xlsx（UTF-8，乱码时再试 GB18030）。`.xls` 请用本机应用打开
- 新建空白文件；新建终端标签（<kbd>Alt</kbd>+<kbd>J</kbd>）

### 文件树

- 浏览、展开、打开、新建、重命名、删除（删除前确认）
- 显示/隐藏隐藏文件；`.gitignore` 忽略项有标记
- 按文件名筛选
- 用本机 Cursor、VS Code、VS Code Insiders、VSCodium、Windsurf、Zed 或系统默认应用打开文件或整个工作区（只启动已安装的软件）
- 目录过大时截断并提示

### Git

- 还不是仓库时：`git init`，并填写 `user.name` / `user.email`
- 已暂存 / 更改 / 未跟踪
- 暂存、取消暂存、整栏操作
- 撤销未提交修改、删除未跟踪文件（确认后才执行）
- 点文件在编辑器看 diff
- 提交、提交全部更改、<kbd>Ctrl</kbd>+<kbd>Enter</kbd>
- AI 流式生成提交说明，模板可改
- fetch / pull / push。有未提交改动、落后远端、分离 HEAD、没有上游时会拦住，避免点错。没有 `--force`
- 拉取方式：合并 / 仅快进 / 变基。推送方式：普通 / 带租约强制推送
- 切换分支、新建并切换、合并（有冲突会自动取消，不留半成品）
- 超前 / 落后、远程探测
- GRAPH：提交图、紧凑/完整、复制哈希、展开文件、打开提交差异、拖高度
- 对话工具：`git_status`、`git_diff`、`git_log`、`git_branch`、`git_commit`（提交需你确认；没有 delete / `reset --hard` / `clean`）

### 用量

- 官方接口余额；币种符号跟接口走（人民币 `¥`，美元 `$`）
- 本机观察消耗（充值不会冲掉）。官方 API Key 接口不返回累计消费
- 本会话 Token：输入 / 输出 / 缓存命中 / 缓存写入 / 命中率
- 上下文占用
- 打开官网用量页
- 钉到左侧 **Settings** 上方，可再收回右侧。左侧栏收起时也能钉进缩略条
- 拖高度，不会盖住上面的会话列表；内容可滚，不画垂直滚动条
- 底部状态栏在「反馈」左侧常驻余额；读不到时显示 `—`（或 `¥—` / `$—`）

### 状态栏

- 可左右滑动的已打开文件标签
- 余额、反馈（GitHub Issues）、版本（GitHub 仓库）、升级入口（npm）
- 工作区路径（token 已脱敏）、当前分支、改动文件数
- 编辑模式菜单

### 智能终端

- 工作区目录下的本机 xterm.js 伪终端
- 自动区分命令和自然语言；粘贴的 `$ ls` 仍按命令执行
- 多标签（<kbd>Alt</kbd>+<kbd>J</kbd>）；每个标签独立 PTY 和 AI 助手；第一个终端标签会钉住
- AI 命令助手（<kbd>Alt</kbd>+<kbd>I</kbd> 或工具栏 ✨）
- 问候 / 警告 / 说明写成不可执行语句
- 可配置危险命令黑名单（只拦助手代敲，你在终端里手打的不受影响）
- 助手设置：分割线、执行前一句话说明、识别到真命令是否直接执行、自定义翻译提示词
- 中断（<kbd>Ctrl</kbd>+<kbd>C</kbd>）、重连、复制输出
- POSIX：bash / zsh / sh / dash。Windows：先 Git Bash，再 Windows PowerShell。详见[工作区终端](#工作区终端)

### 维护

- 中 / 英界面
- 可关闭的升级提示；安装命令以 `#` 注释写入终端
- 界面和报错里的 token、密码、Bearer 会脱敏；URL 仍保留主机和路径

## 能力矩阵

| 能力领域 | 能力点 | 说明 | 状态 |
| --- | --- | --- | --- |
| 工作台 | 三栏布局 | 对话 \| 编辑器 + 终端 \| 文件 / Git / 用量 | 已支持 |
| 工作台 | 自动打开 | 新建会话即打开工作台，不必先提问 | 已支持 |
| 工作台 | 调宽 / 收起 | 拖分隔条（双击恢复）；收成图标条；宽度记忆 | 已支持 |
| 编辑器 | 语法高亮 | JS / TS / JSX / TSX / JSON / HTML / CSS / Markdown / Python / XML / YAML | 已支持 |
| 编辑器 | 快捷键 | 普通 / Emacs / Vim；持久保存；默认 Emacs | 已支持 |
| 编辑器 | 标签与保存 | 多标签、未保存关闭确认、关闭全部 / 其他 / 左 / 右 | 已支持 |
| 编辑器 | Markdown | 编辑 / 预览 / 分栏；图片；Mermaid；安全文件链接 | 已支持 |
| 编辑器 | 图片预览 | png / jpg / jpeg / gif / webp / avif / bmp / ico | 已支持 |
| 编辑器 | 表格预览 | csv / tsv / xlsx；`.xls` 请用本机打开 | 已支持 |
| 编辑器 | 差异 | 工作区 diff 与提交 diff 以标签打开 | 已支持 |
| 文件 | 文件树 | 浏览 / 筛选 / 隐藏文件 / 忽略标记 / 新建 / 重命名 / 删除 | 已支持 |
| 文件 | 外部打开 | Cursor / VS Code / Insiders / VSCodium / Windsurf / Zed / 系统默认 | 已支持 |
| Git | 状态与提交 | 暂存 / 撤销 / 提交 / AI 说明 / 模板 | 已支持 |
| Git | 同步 | fetch / pull / push，脏工作区 / 落后 / 分离 HEAD 会拦住；无 `--force` | 已支持 |
| Git | 分支 | 切换 / 新建 / 合并；`git init` 与身份 | 已支持 |
| Git | GRAPH | 提交图、紧凑模式、复制哈希、提交文件 diff | 已支持 |
| Git | 模型工具 | `git_status` / `git_diff` / `git_log` / `git_branch` / `git_commit` | 已支持 |
| 用量 | 余额与 Token | 官方余额、本机观察消耗、本会话 Token、上下文 | 已支持 |
| 用量 | 钉住 | 钉到左侧 Settings 上方（含收起态）；状态栏 ¥ / $ | 已支持 |
| 状态栏 | 底栏 | 文件标签、反馈、版本、路径、分支、改动、编辑模式 | 已支持 |
| 智能终端 | 本地 PTY | xterm.js；POSIX bash / zsh / sh / dash 及路径约束 | 已支持 |
| 智能终端 | 命令与自然语言 | 真实 argv 直接写入；请求交给模型翻译 | 已支持 |
| 智能终端 | 多终端标签 | <kbd>Alt</kbd>+<kbd>J</kbd>；每标签独立 PTY | 已支持 |
| 智能终端 | 自然语言翻译 | <kbd>Alt</kbd>+<kbd>I</kbd>，写入当前会话 shell | 已支持 |
| 智能终端 | 说明语句隔离 | 问候 / 警告永不执行 | 已支持 |
| 智能终端 | 危险命令黑名单 | 只拦助手代敲；规则可配置 | 已支持 |
| 智能终端 | Windows — Git Bash | 标准 Git for Windows 路径 | 已支持 |
| 智能终端 | Windows — PowerShell | 无 Git Bash 时用系统 PowerShell | 已支持 |
| 维护 | 版本升级检查 | 界面提示 + 终端 `#` 安装命令 | 已支持 |
| 维护 | 语言包 | 中 / 英 | 已支持 |
| 隐私 | 密钥脱敏 | 界面 / 报错 / 路径中的 token | 已支持 |
| 兼容性 | 测试覆盖以外的 shell | fish / tcsh / csh / ksh / mksh / cmd / 以 `ash` 为名的 BusyBox；`$SHELL` 指向它们时回退到已覆盖的 shell | 未测试覆盖 |
| 兼容性 | 远程 SSH 跳板会话 | 尚未纳入测试覆盖 | 未测试覆盖 |

## 发行信息

| 项目 | 说明 |
| --- | --- |
| 包名 | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| 当前版本 | **0.1.15**（npm 标签 `latest`） |
| 软件源 | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.15
```

维护者发布 npm 请执行 `bash devops/release.sh`。该脚本使用本机已有的 `npm login` 会话；不得将账号或凭据写入仓库。

应用市场走 GitHub 安装（`github:loadingvx/deepseek-harness-workbench-plugin`），**不会在用户机器上编译**。每次推 GitHub 之前先执行 `bash devops/build.sh`，把 `lib/index.js` 和 `lib/client.js` 与源码一起提交。

## 安装

### 前置条件

已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并且能够启动 `dsh web`。

### 步骤

1. 安装插件（必须带版本号，不要省略 `@0.1.15`）：

```bash
dsh plugin --profile web add dsh-workbench-plugin@0.1.15
```

`dsh plugin add` 底层是 pnpm。pnpm 11 默认要等一个版本**发布满 24 小时**才会把它当成 `latest`。只写 `dsh-workbench-plugin`、不带 `@版本号` 时，可能静默装上 **0.1.0**，而且命令仍然成功退出。写上 `@0.1.15` 才会明确要这一版。

若指定版本后仍提示太新、装不上，在 `~/.dsh/profiles/web/pnpm-workspace.yaml` 加上下面两行，再执行一次安装命令：

```yaml
minimumReleaseAgeExclude:
  - dsh-workbench-plugin
```

2. 重启 `dsh web`。
3. 访问 http://127.0.0.1:3080 ，进入「对话」并新建会话。工作台会立刻在右侧打开，不必先提问。发出第一轮对话后，标题栏的 **工作台** 按钮可以随时开关。

### 应用市场 / GitHub

市场分配的安装命令装的是 GitHub 仓库，不是 npm 包：

```bash
dsh plugin --profile web add github:loadingvx/deepseek-harness-workbench-plugin
```

默认分支里必须已经有构建好的 `lib/index.js` 和 `lib/client.js`。只提交源码会装不上：pnpm 默认拦截 git 包的 `prepare` 构建脚本，用户会看到 `allowBuilds` 报错。装完后同样重启 `dsh web`，再打开工作台。

## 升级

### 自动提示

若当前环境已安装较低版本，文件与 Git 侧栏顶部将显示可关闭的升级提示。升级说明及安装命令会写入工作区终端，并以 `#` 开头（作为注释，不会被执行）。去掉行首 `#` 后按回车即可安装；安装完成后须重启 `dsh web`。

```bash
# dsh plugin --profile web add dsh-workbench-plugin@<最新版本号>
```

查询软件源失败时不显示提示。关闭提示仅忽略当前这一次最新版本；此后若出现更新的版本，仍会再次提示。

### 从 0.1.1 升级

**0.1.1 未包含升级检查逻辑，因此不会显示上述提示。** 请按安装命令手动升级至 0.1.15；此后版本将通过界面提示。

## 界面

工作台为三栏布局。左侧为系统对话；右侧两栏为能力区：中央为编辑器与终端，最右侧为文件树、Git 与用量。

![screen_1](docs/img/screen_shot_1.png)
![screen_2](docs/img/screen_shot_2.png)
![screen_3](docs/img/screen_shot_3.png)
![screen_4](docs/img/screen_shot_4.png)
![screen_5](docs/img/screen_shot_5.png)
![screen_6](docs/img/screen_shot_6.png)

![工作台：对话、终端、文件与 Git](docs/img/workbench.png)

![编辑器与文件树](docs/img/terminal.png)

社交预览静图见 [`docs/img/social-preview.png`](docs/img/social-preview.png)。

## 工作区终端

工作区终端基于本机伪终端（PTY）。AI 命令助手将自然语言转换为 shell 命令，写入**当前会话**所用的 shell；问候与说明以不可执行语句写入，不会被执行。已测试与尚未测试的 shell 覆盖情况见[能力矩阵](#能力矩阵)。

### 允许的 shell（POSIX）

| 名称 | 选用条件 | 命令助手验证情况 |
| --- | --- | --- |
| **bash** | `$SHELL` 为 bash；或 `$SHELL` 不在本表其余行时的默认首选 | 已验证（含 `failglob` 与交互式历史展开） |
| **zsh** | `$SHELL` 为 zsh | 已验证（含默认 `nomatch`）。交互式 zsh **默认不将 `#` 视为注释**，因此说明行不以裸 `#` 写入 |
| **sh** | `$SHELL` 为 sh；或 bash、zsh 均不可用时的兜底 | 已验证。`/bin/sh` 可能为 bash 或 dash 的符号链接，以本机实际指向为准 |
| **dash** | 仅当 `$SHELL` 明确为 dash（`/bin/dash`、`/usr/bin/dash` 或 `/usr/local/bin/dash`） | 与 sh 相同，采用 POSIX `:` 空操作。默认候选列表**不会**主动选择 dash |

### 允许的 shell（Windows）

| 名称 | 选用条件 | 命令助手验证情况 |
| --- | --- | --- |
| **Git Bash** | 探测 `C:/Program Files/Git/bin/bash.exe` 与 `C:/Program Files/Git/usr/bin/bash.exe`，存在即选用 | 尚未测试覆盖 |
| **Windows PowerShell** | 探测 `%SystemRoot%/System32/WindowsPowerShell/v1.0/powershell.exe`，Git Bash 不可用时选用 | 尚未测试覆盖 |

### 路径约束

仅接受位于 `/bin`、`/usr/bin`、`/usr/local/bin` 下、且文件名为上表四种 POSIX 名称之一的绝对路径，例如 `/bin/bash`、`/usr/bin/zsh`。Windows 下接受指向 Git Bash 与 PowerShell 可执行文件的绝对路径。其余路径（包括用户目录下的自定义安装路径）一律忽略，以免执行未知程序。

### 选择顺序

Windows 下依次探测 Git Bash、系统 PowerShell，随后才轮及下方的 POSIX 候选。POSIX 选择顺序：

1. `$SHELL`（须在白名单内）
2. `/bin/bash`
3. `/usr/bin/bash`
4. `/bin/zsh`
5. `/usr/bin/zsh`
6. `/bin/sh`
7. `/usr/bin/sh`

若上述路径均不可用，则无法启动终端。尚未测试覆盖的 shell（fish、tcsh、csh、ksh、mksh、cmd 及以 `ash` 为名的 BusyBox）见[能力矩阵](#能力矩阵)：当 `$SHELL` 指向其中之一时，该值会被忽略，并在可用时回退至已覆盖的 shell。BusyBox 仅在系统将其提供为 `/bin/sh` 时按 **sh** 处理，名称 `ash` 尚未纳入测试覆盖。

## AI 命令助手

<kbd>Alt</kbd>+<kbd>J</kbd> 新建一个终端标签；每个标签各自持有独立的 PTY 会话与 AI 助手状态，互不串扰。

按 <kbd>Alt</kbd>+<kbd>I</kbd>（或终端工具栏的 ✨ 按钮）打开当前终端底部的 AI 命令助手，将自然语言请求转换为 shell 命令，写入该终端所用的 shell，不启动独立 shell。问候、风险说明与命令前的一行解释以不可执行语句写入，不会被执行。

## 许可证

MIT
