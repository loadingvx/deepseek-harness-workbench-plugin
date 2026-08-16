
![preview](docs/img/social-preview.jpg)



A workbench plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. After Workbench is opened in Conversation, chat stays on the left. Two new columns appear on the right: the editor (syntax highlighting and terminal) and files & Git.

## Contents

- [Release](#release)
- [Installation](#installation)
- [Upgrade](#upgrade)
- [Interface](#interface)
- [Workspace terminal](#workspace-terminal)
- [AI command assist](#ai-command-assist)
- [License](#license)

## Release

| Item | Description |
| --- | --- |
| Package | [`dsh-workbench-plugin`](https://www.npmjs.com/package/dsh-workbench-plugin) |
| Version | **0.1.7** (npm tag `latest`) |
| Registry | https://registry.npmjs.org |

```
+ dsh-workbench-plugin@0.1.7
```

Maintainers publish with `bash devops/release.sh`. The script uses the existing `npm login` session on this machine. Credentials must not be stored in the repository.

## Installation

### Prerequisites

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is installed, and `dsh web` can be started.

### Procedure

1. Install the plugin:

```bash
dsh plugin --profile web add dsh-workbench-plugin
```

2. Restart `dsh web`.
3. Open http://127.0.0.1:3080, enter **Conversation**, and select **Workbench** in the header.

## Upgrade

### Automatic notice

When a lower version is already installed, a dismissible notice appears at the top of the Files / Git sidebar. The upgrade description and install command are written to the workspace terminal as `#` comments and are not executed. Remove the leading `#`, press Enter, then restart `dsh web`.

```bash
# dsh plugin --profile web add dsh-workbench-plugin@<latest>
```

If the registry lookup fails, no notice is shown. Dismissing the notice skips only that latest version; a subsequent newer release will prompt again.

### Upgrading from 0.1.1

**Version 0.1.1 does not include the upgrade checker and will not display the notice.** Install 0.1.7 manually using the command above. Later releases will prompt in the UI.

## Interface

The workbench uses a three-column layout. Conversation stays on the left. The two columns on the right are the new capability area: editor and terminal in the center, file tree and Git on the far right.

![Workbench: chat, terminal, files & Git](docs/img/workbench.png)

![Editor and file tree](docs/img/terminal.png)

Markdown preview (the 👁 mode in the editor) renders images: `http(s)` URLs load directly, and workspace-relative paths such as `./img/x.png`, `../img/x.png`, or `/img/x.png` are served as raw bytes through the workbench API. Sources escaping the workspace root and `data:`/ `javascript:` URLs are skipped.

## Workspace terminal

The workspace terminal is a local pseudo-terminal (PTY). AI command assist converts natural language into commands and writes greetings or notes as non-executable statements. Both are typed into the **current session** shell. Assist compatibility follows the same shell allowlist; shells outside that list are not supported separately.

### Allowed shells

| Name | Selection criteria | Assist verification |
| --- | --- | --- |
| **bash** | `$SHELL` is bash; otherwise the default when `$SHELL` is not one of the remaining rows | Verified (including `failglob` and interactive history expansion) |
| **zsh** | `$SHELL` is zsh | Verified (including default `nomatch`). Interactive zsh does **not** treat `#` as a comment by default, so notes are not written as a bare `#` line |
| **sh** | `$SHELL` is sh; otherwise the fallback when bash and zsh are unavailable | Verified. `/bin/sh` may be a symlink to bash or dash; the symlink target is used as-is |
| **dash** | Only when `$SHELL` is explicitly dash (`/bin/dash`, `/usr/bin/dash`, or `/usr/local/bin/dash`) | Same POSIX `:` no-op as sh. Dash is **not** included in the default candidate list |

### Path constraints

Absolute paths are accepted only under `/bin`, `/usr/bin`, or `/usr/local/bin`, and only for the four names in the table above (for example `/bin/bash`, `/usr/bin/zsh`). All other paths, including custom installs under a home directory, are ignored so that unknown programs are not executed.

### Selection order

1. `$SHELL` (must be on the allowlist)
2. `/bin/bash`
3. `/usr/bin/bash`
4. `/bin/zsh`
5. `/usr/bin/zsh`
6. `/bin/sh`
7. `/usr/bin/sh`

If none of these paths are available, the terminal cannot start.

### Not covered by basic tests

The following types have not been through basic tests:

- fish
- tcsh
- csh
- ksh
- mksh
- PowerShell
- cmd
- BusyBox when invoked as `ash`

If `$SHELL` is one of the above, the workbench **ignores** that value and falls back to bash, zsh, or sh when those binaries exist.

BusyBox is treated as **sh** only when the operating system exposes it as `/bin/sh`. The name `ash` is not on the allowlist and has not been tested separately.

### Out of scope

The following are outside the compatibility scope:

- Windows consoles
- Remote SSH jump-host sessions
- Custom shells outside the allowlist

## AI command assist

Shortcut: <kbd>Alt</kbd>+<kbd>I</kbd>. Assist writes into the current PTY and does not start a separate shell.

### Isolation of note lines

Greetings, warnings, and the one-line summary before a command are written as a POSIX no-op:

```text
: '# --------'
: '# list files in the current directory'
ls -la
```

`:` performs no operation. The argument is single-quoted so that zsh does not treat `today?` as a glob and bash/zsh do not treat `!` as history expansion. Commands intended for execution are still written as emitted by the model (typically one bash or zsh line).

## License

MIT
