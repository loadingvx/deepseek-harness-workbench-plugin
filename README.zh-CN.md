# dsh-workbench-plugin

[English](README.md) | [中文](README.zh-CN.md)

DeepSeek Harness Web UI 的工作台界面插件：在「对话」里打开 Cursor 风格三栏（对话 / 编辑器 / 文件与 Git）。中间文件编辑支持语法高亮。

![工作台：对话 / 终端 / 文件与 Git](docs/img/workbench.png)

![编辑器与文件树](docs/img/terminal.png)

## 发版状态

| 项 | 值 |
| --- | --- |
| 包名 | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| 版本 | **0.1.6**（`latest`） |
| 仓库 | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.6
```

维护者发版：`bash devops/release.sh`（使用本机已有的 `npm login`，不要把账号密码写进仓库）。

## 安装

需要已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并能启动 `dsh web`。

```bash
dsh plugin --profile web add dsh-workbench-plugin
```

装完后**重启** `dsh web`，打开 http://127.0.0.1:3080 →「对话」→ 标题栏右侧 **工作台**。

## 升级

已经装过旧版本时，右侧「文件 / Git」栏顶部会出现一条可关闭的提示。升级说明和命令会自动写进工作区终端，行首带 `#`（注释，不会真的执行）。去掉 `#` 再回车即可安装，然后重启 `dsh web`。

```bash
# dsh plugin --profile web add dsh-workbench-plugin@最新版本号
```

网上查不到新版本时不会打扰你。点右侧关闭只跳过当前这个新版本；再出更新还会再提示。

**已经装了 0.1.1 的人这次看不到这条提示**（旧包里还没有这段检查）。请手动执行一次上面的命令升到 0.1.6，之后有新版本就会自动提醒。

## 工作区终端与 AI 命令助手（Alt+I）

终端是本机真伪终端。AI 命令助手把自然语言翻成命令、把问候写成不执行的说明，都写进**当前这个** shell。兼容范围以选壳白名单为准，助手不再单独支持其它壳。

### 允许的 shell

| 名称 | 何时会用到 | 助手写入方式 |
| --- | --- | --- |
| **bash** | `$SHELL` 是 bash，或本机没有把 `$SHELL` 配成下面几种时的默认首选 | 已实测（含 `failglob`、交互式历史展开） |
| **zsh** | `$SHELL` 是 zsh | 已实测（含默认 `nomatch`）。交互式 zsh **默认不把 `#` 当注释**，所以说明行不用裸 `#` |
| **sh** | `$SHELL` 是 sh，或找不到 bash/zsh 时的兜底 | 已实测。`/bin/sh` 可能是 bash 或 dash 的符号链接，以本机为准 |
| **dash** | 仅当 `$SHELL` 明确是 dash（`/bin/dash`、`/usr/bin/dash` 或 `/usr/local/bin/dash`） | 语法按 POSIX `:` 空操作处理，与 sh 相同。默认候选列表**不会**主动选 dash |

绝对路径只接受：`/bin`、`/usr/bin`、`/usr/local/bin` 下的上述四个名字。例如 `/bin/bash`、`/usr/bin/zsh`。其它路径（包括 `~/.local/bin/zsh`、`/tmp/evil`）一律不用，避免跑到未知程序。

选择顺序：先看 `$SHELL`（必须在白名单里）→ `/bin/bash` → `/usr/bin/bash` → `/bin/zsh` → `/usr/bin/zsh` → `/bin/sh` → `/usr/bin/sh`。一个都没有则无法打开终端。

### 明确不支持

fish、tcsh、csh、ksh、mksh、PowerShell、cmd、BusyBox 以 `ash` 为名的入口。若 `$SHELL` 是这些，工作台会**忽略**它，改用上面的 bash/zsh/sh 兜底（有的话）。

BusyBox 只有在系统把它做成 `/bin/sh` 时才会作为 **sh** 进来；没有单独测过 `ash` 这个名字。

### 助手在这些壳里怎么保证「说明不会被执行」

问候、风险说明、命令前的一句话解释，都写成 POSIX 空操作：

```text
: '# --------'
: '# 列出当前目录'
ls -la
```

`:` 什么都不做；整段单引号包住，避免 zsh 把 `today?` 当通配符、避免 bash/zsh 把 `!` 当历史展开。真正要跑的命令仍按模型给出的原文执行（一般是 bash/zsh 能懂的一行命令）。

Windows 控制台、远程 SSH 跳板、以及白名单以外的自定义 shell **不在**兼容范围内。

## License

MIT
