# dsh-workbench-plugin

[English](README.md) | [中文](README.zh-CN.md)

A workbench UI plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. Open **Workbench** in Conversation to get a Cursor-style three-column layout: chat / editor / files & Git. The center editor highlights common languages.

![Workbench: chat / terminal / files & Git](docs/img/workbench.png)

![Editor and file tree](docs/img/terminal.png)

## Release

| | |
| --- | --- |
| Package | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| Version | **0.1.6** (`latest`) |
| Registry | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.6
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

**0.1.1 cannot show this banner** (the checker is not in that build). Upgrade once by hand to 0.1.6; later releases will prompt in the UI.

## Workspace terminal and AI command assist (Alt+I)

The terminal is a real local PTY. Command assist (translate a sentence into a command, or write a greeting as a non-executing note) types into **that same** shell. The assist layer does not support any shell outside the PTY allowlist.

### Allowed shells

| Name | When it is used | Assist coverage |
| --- | --- | --- |
| **bash** | `$SHELL` is bash, or the default when `$SHELL` is not one of the rows below | Tested (including `failglob` and interactive history expansion) |
| **zsh** | `$SHELL` is zsh | Tested (including default `nomatch`). Interactive zsh does **not** treat `#` as a comment by default, so notes are not sent as a bare `#` line |
| **sh** | `$SHELL` is sh, or the last fallback if bash/zsh are missing | Tested. `/bin/sh` may be a symlink to bash or dash; whatever the machine provides is what you get |
| **dash** | Only if `$SHELL` is explicitly dash (`/bin/dash`, `/usr/bin/dash`, or `/usr/local/bin/dash`) | Same POSIX `:` no-op as sh. Dash is **not** in the default candidate list |

Absolute paths are accepted only under `/bin`, `/usr/bin`, or `/usr/local/bin`, and only for those four names (e.g. `/bin/bash`, `/usr/bin/zsh`). Anything else (including `~/.local/bin/zsh` or `/tmp/evil`) is ignored.

Selection order: `$SHELL` if it is on the allowlist → `/bin/bash` → `/usr/bin/bash` → `/bin/zsh` → `/usr/bin/zsh` → `/bin/sh` → `/usr/bin/sh`. If none exist, the terminal cannot start.

### Not supported

fish, tcsh, csh, ksh, mksh, PowerShell, cmd, and BusyBox when invoked as `ash`. If `$SHELL` is one of these, the workbench **ignores** it and falls back to bash/zsh/sh when those binaries exist.

BusyBox is only in scope if the OS exposes it as `/bin/sh` (then it is treated as **sh**). The name `ash` is not on the allowlist and is untested.

### How assist keeps notes from running

Greetings, warnings, and the one-line explain-before-command are a POSIX no-op:

```text
: '# --------'
: '# list files in the current directory'
ls -la
```

`:` does nothing; the argument is single-quoted so zsh will not glob `today?` and bash/zsh will not hist-expand `!`. Commands that should run are still typed as the model emitted them (typically one bash/zsh line).

Windows consoles, jump-host SSH shells, and custom shells outside the allowlist are **out of scope**.

## License

MIT
