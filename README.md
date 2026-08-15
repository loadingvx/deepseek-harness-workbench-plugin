# dsh-workbench-plugin

[English](README.md) | [中文](README.zh-CN.md)

A workbench UI plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. Open **Workbench** in Conversation to get a Cursor-style three-column layout: chat / editor / files & Git.

![Workbench: chat / editor / files & Git](docs/img/workbench.png)

![Workspace terminal](docs/img/terminal.png)

## Release

| | |
| --- | --- |
| Package | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| Version | **0.1.3** (`latest`) |
| Registry | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.3
```

Maintainers publish with `bash devops/release.sh` (uses your existing `npm login` on the official registry; never put credentials in the repo).

## Install

Requires [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with `dsh web` available.

```bash
dsh plugin --profile web add dsh-workbench-plugin
```

Restart `dsh web`, open http://127.0.0.1:3080 → **Conversation** → **Workbench** in the header.

## Upgrade

If an older build is already installed, a dismissible bar appears at the top of the Files / Git sidebar. The upgrade hint and command are typed into the workspace terminal as `#` comments (they do not run). Remove the `#` and press Enter, then restart `dsh web`.

```bash
# dsh plugin --profile web add dsh-workbench-plugin@<latest>
```

A failed registry lookup stays quiet. Dismiss skips only that latest version; a newer release will prompt again.

**0.1.1 cannot show this banner** (the checker is not in that build). Upgrade once by hand to 0.1.3; later releases will prompt in the UI.

## License

MIT
