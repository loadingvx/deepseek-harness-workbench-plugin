# dsh-workbench-plugin

[English](README.md) | [中文](README.zh-CN.md)

DeepSeek Harness Web UI 的工作台界面插件：在「对话」里打开 Cursor 风格三栏（对话 / 编辑器 / 文件与 Git）。

![工作台：对话 / 编辑器 / 文件与 Git](docs/img/workbench.png)

![工作区终端](docs/img/terminal.png)

## 发版状态

| 项 | 值 |
| --- | --- |
| 包名 | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| 版本 | **0.1.5**（`latest`） |
| 仓库 | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.5
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

**已经装了 0.1.1 的人这次看不到这条提示**（旧包里还没有这段检查）。请手动执行一次上面的命令升到 0.1.5，之后有新版本就会自动提醒。

## License

MIT
