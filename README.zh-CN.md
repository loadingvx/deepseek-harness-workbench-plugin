![preview](docs/img/social-preview.jpg)

DeepSeek Harness Web UI 工作台插件。在「对话」视图中打开工作台后，对话保留在左侧；右侧新增两栏，分别承载编辑器（含语法高亮与终端）以及文件与 Git。

## 目录

- [发行信息](#发行信息)
- [安装](#安装)
- [升级](#升级)
- [界面](#界面)
- [工作区终端](#工作区终端)
- [AI 命令助手](#ai-命令助手)
- [许可证](#许可证)

## 发行信息

| 项目 | 说明 |
| --- | --- |
| 包名 | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| 当前版本 | **0.1.7**（npm 标签 `latest`） |
| 软件源 | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.7
```

维护者发布请执行 `bash devops/release.sh`。该脚本使用本机已有的 `npm login` 会话；不得将账号或凭据写入仓库。

## 安装

### 前置条件

已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并且能够启动 `dsh web`。

### 步骤

1. 安装插件：

```bash
dsh plugin --profile web add dsh-workbench-plugin
```

2. 重启 `dsh web`。
3. 访问 http://127.0.0.1:3080 ，进入「对话」，在标题栏右侧打开 **工作台**。

## 升级

### 自动提示

若当前环境已安装较低版本，文件与 Git 侧栏顶部将显示可关闭的升级提示。升级说明及安装命令会写入工作区终端，并以 `#` 开头（作为注释，不会被执行）。去掉行首 `#` 后按回车即可安装；安装完成后须重启 `dsh web`。

```bash
# dsh plugin --profile web add dsh-workbench-plugin@<最新版本号>
```

查询软件源失败时不显示提示。关闭提示仅忽略当前这一次最新版本；此后若出现更新的版本，仍会再次提示。

### 从 0.1.1 升级

**0.1.1 未包含升级检查逻辑，因此不会显示上述提示。** 请按安装命令手动升级至 0.1.7；此后版本将通过界面提示。

## 界面

工作台为三栏布局。左侧为系统对话；右侧两栏为本次新增的能力区：中央为编辑器与终端，最右侧为文件树与 Git。

![工作台：对话、终端、文件与 Git](docs/img/workbench.png)

![编辑器与文件树](docs/img/terminal.png)

Markdown 预览（编辑器的 👁 模式）支持渲染图片：`http(s)` 地址直接加载，工作区内的相对路径图片（如 `./img/x.png`、`../img/x.png`、`/img/x.png`）会通过工作台接口按原字节加载；越界路径与 `data:`、`javascript:` 等来源会被跳过。

社交预览静图见 [`docs/img/social-preview.png`](docs/img/social-preview.png)。

## 工作区终端

工作区终端基于本机伪终端（PTY）。AI 命令助手将自然语言转换为命令、将问候与说明写入不可执行语句，上述内容均写入**当前会话**所选用的 shell。命令助手的兼容范围与选壳白名单一致，不另行支持白名单以外的 shell。

### 允许的 shell

| 名称 | 选用条件 | 命令助手验证情况 |
| --- | --- | --- |
| **bash** | `$SHELL` 为 bash；或 `$SHELL` 不在本表其余行时的默认首选 | 已验证（含 `failglob` 与交互式历史展开） |
| **zsh** | `$SHELL` 为 zsh | 已验证（含默认 `nomatch`）。交互式 zsh **默认不将 `#` 视为注释**，因此说明行不以裸 `#` 写入 |
| **sh** | `$SHELL` 为 sh；或 bash、zsh 均不可用时的兜底 | 已验证。`/bin/sh` 可能为 bash 或 dash 的符号链接，以本机实际指向为准 |
| **dash** | 仅当 `$SHELL` 明确为 dash（`/bin/dash`、`/usr/bin/dash` 或 `/usr/local/bin/dash`） | 与 sh 相同，采用 POSIX `:` 空操作。默认候选列表**不会**主动选择 dash |

### 路径约束

仅接受位于 `/bin`、`/usr/bin`、`/usr/local/bin` 下、且文件名为上表四种之一的绝对路径，例如 `/bin/bash`、`/usr/bin/zsh`。其余路径（包括用户目录下的自定义安装路径）一律忽略，以免执行未知程序。

### 选择顺序

1. `$SHELL`（须在白名单内）
2. `/bin/bash`
3. `/usr/bin/bash`
4. `/bin/zsh`
5. `/usr/bin/zsh`
6. `/bin/sh`
7. `/usr/bin/sh`

若上述路径均不可用，则无法启动终端。

### 未经基本测试

下列类型尚未经过基本测试：

- fish
- tcsh
- csh
- ksh
- mksh
- PowerShell
- cmd
- BusyBox 以 `ash` 为名的入口

若 `$SHELL` 属于上列，工作台将**忽略**该设置，并在可用时回退至 bash、zsh 或 sh。

BusyBox 仅在系统将其提供为 `/bin/sh` 时，按 **sh** 处理。名称 `ash` 不在白名单内，亦未经单独测试。

### 兼容范围以外

下列情形不在兼容范围内：

- Windows 控制台
- 远程 SSH 跳板会话
- 白名单以外的自定义 shell

## AI 命令助手

快捷键：<kbd>Alt</kbd>+<kbd>I</kbd>。助手向当前 PTY 写入内容，不启动独立 shell。

### 说明语句的执行隔离

问候、风险说明以及命令前的一行解释，均写为 POSIX 空操作：

```text
: '# --------'
: '# 列出当前目录'
ls -la
```

`:` 不执行任何操作；参数以单引号包裹，以避免 zsh 将 `today?` 视为通配符，以及 bash、zsh 将 `!` 视为历史展开。待执行命令仍按模型输出的原文写入（通常为一行 bash 或 zsh 命令）。

## 许可证

MIT
