# Issue: 拖拽分隔条后无法退出，鼠标持续与界面尺寸绑定

- **Issue ID**: ISSUE-0003
- **类型**: Bug（交互 / 指针事件）
- **状态**: 已修复 ✅
- **发现时间**: 2026-08-19
- **修复时间**: 2026-08-19（约 20 分钟，含排查与四处修复）
- **影响版本**: 0.1.x（含当前开发版）
- **涉及文件**:
  - `src/client/workbench/Workbench.tsx`
  - `src/client/workbench/GitSidebar.tsx`
  - `src/client/workbench/UsagePanel.tsx`

## 问题现象

点击进入拖拽状态后**无法退出**：

- 终端底部面板与编辑器上部区域之间的**高度拖拽**（RowSash，水平分隔条）按下后，松开鼠标仍然处于"拖拽中"；
- 鼠标光标一直保持 `row-resize`，且鼠标移动会持续改变面板高度（"鼠标一直和界面高低绑定"）；
- 必须刷新页面才能恢复。

## 问题原因

所有拖拽实现（终端高度、chat/side 列宽、Git 提交图高度、Usage 面板高度）共用同一模式：

1. 在 `pointerdown` 时向 `window` 挂载 `pointermove` / `pointerup` 监听器；
2. 释放时在 `pointerup` 处理器里移除监听并还原 `cursor` / `userSelect`。

**缺少 `setPointerCapture`**。Pointer Events 规范中，指针事件默认派发到命中测试的目标。当指针：

- 移出浏览器窗口后松开；或
- 移动到工作台内的 `<iframe>`（BrowserView 浏览器视图就是 iframe）上松开

时，`pointerup` 事件**不会**派发到 `window`，于是 `up` 处理器永不执行：

- `setDragging(null)` 不执行 → 面板始终显示"拖拽中"高亮；
- `cursor` / `userSelect` 不还原；
- `pointermove` 监听器一直挂在 `window` 上 → 鼠标移动就持续改变尺寸。

## 修复方案

对**全部四处**拖拽（`beginResize` chat/side、`beginTermResize`、GitSidebar `beginResize`、UsagePanel `beginResize`）统一修复：

1. 在 `pointerdown` 里对触发按钮调用 `handle.setPointerCapture(event.pointerId)`（`try/catch` 兜底指针已失效场景）——捕获后所有后续指针事件持续派发到该元素，即使指针移出窗口或进入 iframe，`pointerup` 也一定到达；
2. `up` 处理器改为 `end`，同时监听并移除 `pointercancel` 作为兜底（系统打断 / 触摸取消等场景）；
3. 结束时调用 `handle.releasePointerCapture(event.pointerId)`（`try/catch` 兜底已自动释放场景），再执行原有的清理与持久化。

## 验证

- `pnpm test`：68 个测试文件、579 个用例全部通过；
- `pnpm build`（tsdown）构建成功；
- 修复后拖拽在指针移出窗口 / 经过 iframe 后松开均能正确退出，光标与监听器正常还原。

## 备注

同类风险（无 `setPointerCapture` 的 window 级指针监听）已在工作台内全部清理；后续新增拖拽交互应复用"捕获 + pointerup/pointercancel 双兜底"模式。
