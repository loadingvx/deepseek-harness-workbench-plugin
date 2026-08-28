---
name: bump-version
description: 升级 dsh-workbench-plugin 版本号时使用。列出 package.json 与两个 README 中所有需要同步版本号的位置、必须保留的旧版本字样、验证与发布命令。当任务涉及“更新版本号 / bump version / 版本升级 / 修改 README 中的 0.1.x 版本”时触发。
---

# 更新插件版本号（dsh-workbench-plugin）

插件版本号是 `x.y.z`（当前 **0.1.32**）。升级版本时，版本号只出现在 **3 个文件、13 处**，一次改完即可；其余位置都无需改动。先读 `package.json` 的 `version` 确认当前号，再升一档；不要沿用本文示例里过期的行号数字而不核对文件。

## 需要更新的位置（共 13 处）

### 1. `package.json`（唯一事实来源）

- 第 3 行：`"version": "0.1.32"`

### 2. `README.md`（6 处，全部替换为同一新版本号）

- 发行信息表：`| Version | **0.1.32** (npm tag `latest`) |`
- Release 代码块：`+ dsh-workbench-plugin@0.1.32`
- 安装步骤 1：`1. Install the plugin (pin the version; do not omit `@0.1.32`):`
- 安装命令：`dsh plugin --profile web add dsh-workbench-plugin@0.1.32`
- 版本固定说明：`Pinning `@0.1.32` requests that release explicitly.`
- 升级说明：`**Version 0.1.1 does not include the upgrade checker and will not display the notice.** Install 0.1.32 manually using the command above.`（只替换句中当前版本，句首的 0.1.1 保留）

### 3. `README.zh-CN.md`（6 处，与英文版一一对应）

- 发行信息表：`| 当前版本 | **0.1.32**（npm 标签 `latest`） |`
- 发行代码块：`+ dsh-workbench-plugin@0.1.32`
- 安装步骤 1：`1. 安装插件（必须带版本号，不要省略 `@0.1.32`）：`
- 安装命令：`dsh plugin --profile web add dsh-workbench-plugin@0.1.32`
- 版本固定说明：`写上 `@0.1.32` 才会明确要这一版。`
- 升级说明：`**0.1.1 未包含升级检查逻辑，因此不会显示上述提示。** 请按安装命令手动升级至 0.1.32；此后版本将通过界面提示。`（只替换句中当前版本，句首的 0.1.1 保留）

完成本次升级后，把本技能里的「当前版本」示例同步成新号，避免下次沿用过期数字。

## 刻意保留、不要改的旧版本字样

- **`0.1.0`**：README 中说明“不带版本号安装可能静默装上 0.1.0”——是历史事实，不是当前版本。
- **`0.1.1`**：README 中“0.1.1 未包含升级检查逻辑”——是历史事实，不是当前版本。
- 只把**当前版本号**（如 0.1.32）整串替换，上面两个历史字样原样保留。

## 无需改动的位置（已核实）

- **`pnpm-lock.yaml`**：importer 区不含根包 version，依赖版本号与插件自身版本无关。
- **`src/shared/version.ts`**：只含 `PLUGIN_NAME`、npm/GitHub 页面 URL，没有硬编码版本。
- **`lib/index.js` / `lib/client.js`**：构建产物，运行时动态读取 package.json 的 version；改版本后如需重新构建，执行 `pnpm build`（或发布前 `bash devops/build.sh` 再提交 lib 到 git）。
- **`src/`、`tests/`、`docs/`、`cordis.patch.yml`**：无版本号引用。

## 改完后的验证

```bash
# 旧版本号（替换为新版号前）应无残留，例如从 0.1.31 升到 0.1.32 后：
grep -Frn '0.1.31' package.json README.md README.zh-CN.md   # 期望：无输出
# 新版本号应在 3 个文件共出现 13 次：
grep -Frn '0.1.32' package.json README.md README.zh-CN.md
```

## 发布流程

- `bash devops/release.sh` 基于 package.json 的 version 发布 npm；`patch` / `minor` / `major` 参数会用 `npm version --no-git-tag-version` 只改 package.json，**不会**同步 README——所以先手动改完 README 再发布。
- 发布前先 `--dry-run` 演练；发布前会自动跑测试和构建。
- git 提交信息沿用历史习惯：`chore: bump version to 0.1.x` 或 `docs: … and bump version to 0.1.x`，且每次推 GitHub 前要提交构建好的 lib 文件。