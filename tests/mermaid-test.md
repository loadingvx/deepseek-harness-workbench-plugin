# Mermaid 渲染测试（Markdown 预览）

> **路径**：`tests/mermaid-test.md`  
> **用途**：在工作台编辑器中打开本文件，切换到 **预览**（👁）或 **分栏** 模式，逐块检查 Mermaid 是否正常渲染。

当前渲染引擎：[beautiful-mermaid](https://www.npmjs.com/package/beautiful-mermaid)（已打进插件 `client.js`，无需额外加载 vendor 脚本）。

## 怎么判断

| 现象 | 含义 |
| --- | --- |
| 代码块变成 SVG 图表 | ✅ 当前引擎支持该语法 |
| 灰色虚线框 + 保留源码 + 顶部错误提示 | ❌ 不支持或语法有误（属预期行为） |
| 仍是普通灰色代码块、完全没有图形 | 预览未启用 Mermaid，或插件未加载 |

---

## ✅ 支持的图表（应渲染为 SVG）

### 1. 流程图 · 自上而下 `graph TD`

```mermaid
graph TD
    A[开始] --> B{是否就绪?}
    B -->|是| C[执行任务]
    B -->|否| D[等待]
    C --> E[完成]
    D --> B
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style C fill:#bbf,stroke:#333,stroke-width:2px
```

### 2. 流程图 · 自左向右 `flowchart LR`（含子图）

```mermaid
flowchart LR
    subgraph 客户端
        A["fetch /git/status"] --> B{HTTP 200?}
    end
    B -->|是| C["解析 GitResult"]
    B -->|否| D["显示错误横幅"]
    C --> E["更新侧栏"]
```

### 3. 时序图 `sequenceDiagram`（含 loop / alt）

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as 工作台
    participant H as Host

    U->>W: 点击保存
    W->>H: POST /git/fs/write
    loop 重试 3 次
        H-->>W: 写入结果
    end
    alt 成功
        W-->>U: 已保存
    else 失败
        W-->>U: 显示错误提示
    end
```

### 4. 类图 `classDiagram`

```mermaid
classDiagram
    class GitClient {
        +status(workspaceId) Promise
        +diff(workspaceId, path) Promise
        +commit(workspaceId, message) Promise
    }
    class GitFail {
        +code: string
        +messageZh: string
    }
    GitClient ..> GitFail : 返回
```

### 5. 状态图 `stateDiagram-v2`

```mermaid
stateDiagram-v2
    [*] --> 编辑中
    编辑中 --> 已修改 : 输入内容
    已修改 --> 保存中 : 点击保存
    保存中 --> 已修改 : 失败
    保存中 --> 已保存 : 成功
    已保存 --> [*]
```

### 6. ER 图 `erDiagram`

```mermaid
erDiagram
    WORKSPACE ||--o{ TAB : contains
    WORKSPACE {
        string workspaceId
        string path
    }
    TAB {
        string path
        string kind
    }
```

### 7. XY 图 · 柱状 `xychart-beta`（bar）

```mermaid
xychart-beta
    title "会话 Token 分布"
    x-axis [prompt, completion, tools]
    y-axis "tokens" 0 --> 12000
    bar [8200, 3100, 900]
```

### 8. XY 图 · 折线 `xychart-beta`（line）

```mermaid
xychart-beta
    title "近 7 日用量"
    x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
    y-axis "USD" 0 --> 5
    line [1.2, 0.8, 2.1, 1.5, 3.0, 0.4, 0.6]
```

### 9. XY 图 · 柱线组合

```mermaid
xychart-beta
    title "请求量 vs 错误率"
    x-axis [w1, w2, w3, w4]
    y-axis "count" 0 --> 500
    bar [120, 200, 180, 260]
    line [2, 5, 3, 8]
```

---

## ❌ 暂不支持的图表（应显示错误框并保留源码）

以下语法来自官方 Mermaid，**beautiful-mermaid 尚未实现**。预览时应出现错误提示框，而不是 SVG。

### A. 甘特图 `gantt`

```mermaid
gantt
    title 发布计划
    dateFormat  YYYY-MM-DD
    section 开发
    功能开发      :a1, 2026-08-16, 5d
    单元测试      :a2, after a1, 2d
    section 发布
    构建插件      :b1, after a2, 1d
    上线          :milestone, after b1, 0d
```

### B. 饼图 `pie`

```mermaid
pie title 语言占比
    "TypeScript" : 70
    "CSS" : 15
    "Markdown" : 15
```

### C. 用户旅程 `journey`

```mermaid
journey
    title 打开工作区
    section 操作
      点击工作台图标: 3: 用户
      选择目录: 4: 用户
    section 加载
      等待文件树: 2: 系统
```

### D. 思维导图 `mindmap`

```mermaid
mindmap
  root((工作台))
    编辑器
      语法高亮
      预览
    文件与Git
      状态
      提交
    终端
      命令助手
```

### E. 时间线 `timeline`

```mermaid
timeline
    title 版本历史
    0.1.1 : 首个版本
    0.1.7 : 升级检查
    0.1.8 : Markdown 图片
```

### F. Git 图 `gitGraph`

```mermaid
gitGraph
    commit id: "a1"
    branch feature
    checkout feature
    commit id: "b1"
    checkout main
    merge feature
```

---

## 对照：普通代码块（非 mermaid）

下面应**始终**显示为代码，不会变成图表：

```text
graph TD
    A --> B
```

---

## 回归检查清单

打开 `tests/mermaid-test.md` 后快速过一遍：

1. **§1–§9** 共 9 个块 → 全部出现 SVG
2. **§A–§F** 共 6 个块 → 全部出现错误框（含原始源码）
3. 最底部 `text` 代码块 → 保持代码样式
4. 切换 **编辑 / 预览 / 分栏** 三种模式，图表不丢失、不重复
5. 切换工作台明暗主题后，图表颜色随 CSS 变量变化（无需刷新整页）

若 §1–§9 任意一块只显示代码，说明 Mermaid 渲染链路异常，请检查插件是否已 `pnpm run build` 并重新 `bash devops/dev.sh`。
