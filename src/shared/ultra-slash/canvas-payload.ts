/**
 * Default steer payloads for `/canvas`. Kept separate from locales.ts because
 * the guidance is long and versioned with the canvas workflow itself.
 */

/** Shipped `/canvas` guidance (zh). */
export const CANVAS_PAYLOAD_ZH = `在当前工作区根目录的 \`.canvas/\` 目录下创建 Canvas 可视化文件（\`.canvas.tsx\`），用于独立展示产品原型、分析看板或自定义交互内容。不要只在聊天里贴代码——必须用写入文件工具把文件落盘。

## 文件位置与命名
- 目录：工作区根目录下的 \`.canvas/\`（不存在则创建；不要放到用户主目录或 IDE 配置目录）
- 文件名：\`<描述性-kebab名>.canvas.tsx\`，例如 \`order-dashboard.canvas.tsx\`、\`login-prototype.canvas.tsx\`
- 每个 Canvas 恰好一个文件：不要创建辅助模块、独立样式文件或子目录

## 何时创建 Canvas
**适合：** 产品原型 / UI 线框、数据分析看板、架构或安全审查、流程与拓扑图、对比表、时间线、可交互探索工具、MCP/查询结果的结构化展示（数据本身就是交付物）
**不适合：** 普通代码修改、短问答、用户指定要用其他工具交付的内容、中间步骤的临时查询结果

## 编写规范
- 默认 export 一个 React 函数组件
- 单文件自包含：仅使用 React 与内联 \`style\`（不要 \`fetch\`、不要相对 import 其他模块、不要 npm 包）
- 所有展示数据内嵌在文件中
- 界面文案、标题、按钮优先使用中文
- **禁止空状态占位**（"TODO"、"示例"、"暂无数据"、空表格、空图表框）——某区块没有真实内容就不要渲染；若整个 Canvas 无内容可写，不要创建文件，先说明缺什么并询问用户

## 产品原型与设计
- 明确页面结构、导航、核心操作路径；用合理假数据展示真实交互态（按钮、表单、列表、Tab、侧栏等）
- 视觉层次：主内容更大更醒目，次要信息紧凑；扁平简洁——无渐变、无 emoji 装饰、无 box-shadow
- 图表/表格需自解释：标题写清指标名，轴标注单位，多系列加图例，注明数据来源或时间范围

## 用户追加说明
若用户在 \`/canvas\` 后写了具体主题或需求，以其为准决定文件名、布局与内容重点。

## 交付
- 写完后在回复中给出 \`.canvas/<文件名>.canvas.tsx\` 的完整路径（可点击打开）
- 工作台会自动打开该 Canvas 并以 **预览模式** 渲染 React 内容；需要改代码时可切回编辑`

/** Shipped `/canvas` guidance (en). */
export const CANVAS_PAYLOAD_EN = `Create a Canvas visualization file (\`.canvas.tsx\`) under \`.canvas/\` at the workspace root — for product prototypes, analysis dashboards, or custom interactive content. Do not paste code only in chat; you must write the file to disk with the write tool.

## Location and naming
- Directory: \`.canvas/\` at the workspace root (create it if missing; do not use the user home directory or IDE config paths)
- Filename: \`<descriptive-kebab-name>.canvas.tsx\`, e.g. \`order-dashboard.canvas.tsx\`, \`login-prototype.canvas.tsx\`
- Exactly one file per canvas: no helper modules, separate style files, or subfolders

## When to create a canvas
**Use for:** product prototypes / UI wireframes, data dashboards, architecture or security reviews, flow and topology diagrams, comparison tables, timelines, interactive explorations, structured MCP/query results where the data is the deliverable
**Skip for:** routine code edits, short Q&A, deliverables the user asked for in another tool, intermediate query results for a different goal

## Authoring rules
- Default-export one React function component
- Self-contained single file: React and inline \`style\` only (no \`fetch\`, no relative imports, no npm packages)
- Embed all display data in the file
- Default-export labels and copy in the user's language when known; prefer Chinese for this project
- **Never render empty placeholders** ("TODO", "Example", "No data", empty tables, empty chart frames) — omit sections with no real content; if the whole canvas would be empty, do not create the file — explain what is missing and ask the user

## Product design
- Define page structure, navigation, and core flows; use plausible mock data for real interaction states (buttons, forms, lists, tabs, sidebars)
- Visual hierarchy: primary content gets more space and emphasis; flat and minimal — no gradients, emoji decoration, or box-shadow
- Charts and tables must be self-describing: specific metric titles, axis units, legends for multiple series, source or time range captions

## User suffix
If the user typed a topic or requirements after \`/canvas\`, treat that as the primary scope for filename, layout, and content.

## Delivery
- After writing, link the full path \`.canvas/<filename>.canvas.tsx\` in your reply (clickable)
- The workbench auto-opens the Canvas in **preview mode** and renders the React output; switch to edit to change the source`
