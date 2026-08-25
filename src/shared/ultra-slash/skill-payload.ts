/**
 * Default steer payloads for `/skill`. Kept separate from locales.ts because
 * the guidance is long and versioned with the DeepSeek Harness skill layout.
 */

/** Shipped `/skill` guidance (zh). */
export const SKILL_PAYLOAD_ZH = `完成当前任务后，把刚才真正管用、以后还能复用的方案写成 DeepSeek Harness 可加载的项目 Skill。不要只在聊天里贴正文——必须用写入文件工具落盘。

## 文件位置（写错则下一步技能目录里看不到）
- 目录：当前工作区根目录下的 \`.dsh/skills/\`（不存在则创建）
- 文件：\`.dsh/skills/<kebab-name>/SKILL.md\`（一个 skill 一个子目录；目录名必须与 frontmatter 的 \`name\` 相同）
- 只允许这一层。禁止写到：工作区根目录、\`./SKILL.md\`、\`.cursor/skills/\`、\`.agents/skills/\`、\`~/.dsh/skills/\`，也不要再套子目录（Harness 不扫描嵌套路径）
- 这是 DeepSeek Harness 扫描项目 skill 的官方路径：\`<projectRoot>/.dsh/skills/\`

## 命名
- \`name\` 只能用小写英文、数字和连字符，例如 \`fix-login-redirect\`、\`k8s-port-forward\`
- 若用户在 \`/skill\` 后写了补充说明，优先用它决定名称和主题
- 若 \`.dsh/skills/<name>/\` 已存在，覆盖更新同一份 \`SKILL.md\`，不要另起名字堆重复

## 文件格式（缺 frontmatter 会被整份跳过）
必须是 Markdown，文件开头用 YAML frontmatter，且包含必填字段 \`name\`、\`description\`：

\`\`\`md
---
name: example-name
description: 一句话说明何时使用。Agent 先看到这句，再决定要不要加载全文。
whenToUse: 可选，更具体的触发场景
---

可复现的步骤、命令、路径约定、验收标准和易错点。写给以后的 Agent 直接执行，不要写本次对话回顾。
\`\`\`

- \`description\` 必填，写清「什么时候该用」，不要只重复名字
- 不要写 \`disable-model-invocation\` 或 \`user-invocable: false\`（写了 Harness 就不会把它交给模型）
- 不要用 camelCase 调用字段（如 \`disableModelInvocation\`），整个 skill 会被丢弃

## 何时不要创建
只是一次性改动、没有可复用步骤时，不要写文件，直接说明原因。

## 交付
写完后在回复里给出 \`.dsh/skills/<name>/SKILL.md\` 的完整相对路径。工作台 Skills 面板和 Agent 技能目录会在下一步看到它。`

/** Shipped `/skill` guidance (en). */
export const SKILL_PAYLOAD_EN = `After you finish this task, save the reusable solution as a DeepSeek Harness project skill. Do not paste the body only in chat; you must write the file to disk with the write tool.

## Location (wrong path = the next catalog will not see it)
- Directory: \`.dsh/skills/\` at the current workspace root (create it if missing)
- File: \`.dsh/skills/<kebab-name>/SKILL.md\` (one subdirectory per skill; the folder name must match frontmatter \`name\`)
- One level only. Do not write to the workspace root, \`./SKILL.md\`, \`.cursor/skills/\`, \`.agents/skills/\`, or \`~/.dsh/skills/\`, and do not nest deeper (Harness does not scan nested trees)
- Official project scan path: \`<projectRoot>/.dsh/skills/\`

## Naming
- \`name\` must be lowercase letters, digits, and hyphens, e.g. \`fix-login-redirect\`, \`k8s-port-forward\`
- If the user typed extra text after \`/skill\`, use it as the name and topic
- If \`.dsh/skills/<name>/\` already exists, overwrite that \`SKILL.md\`; do not invent a duplicate name

## File format (missing frontmatter drops the whole skill)
Markdown with YAML frontmatter at the top. \`name\` and \`description\` are required:

\`\`\`md
---
name: example-name
description: One sentence for when to use this skill. The agent sees this first, then decides whether to load the body.
whenToUse: optional, more specific trigger
---

Reproducible steps, commands, path conventions, acceptance checks, and pitfalls. Write for a future agent to execute; do not recap this chat.
\`\`\`

- \`description\` is required and must say when to use the skill, not just repeat the name
- Do not set \`disable-model-invocation\` or \`user-invocable: false\` (Harness would hide it from the model)
- Do not use camelCase invocation keys such as \`disableModelInvocation\`; the whole skill is discarded

## When not to create
If this was a one-off change with no reusable procedure, do not write a file; explain why.

## Delivery
After writing, give the relative path \`.dsh/skills/<name>/SKILL.md\`. The workbench Skills panel and the agent catalog will pick it up on the next step.`
