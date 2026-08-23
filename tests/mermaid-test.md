# Mermaid 渲染能力测试

本文件用于检查 Markdown 预览是否支持 [Mermaid](https://mermaid.js.org/) 图表。

**判定方法**：在编辑器中打开本文件，切到「预览」（👁）或「分栏」模式。

- ✅ **支持**：下面的 ```mermaid 代码块会渲染成对应图表（流程图、时序图、甘特图等）。
- ❌ **不支持**：所有 ```mermaid 块原样显示为灰色代码块（只看到文本，没有图形）。

---

## 1. 流程图 Flowchart（graph TD，含子图与样式）

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

## 2. 流程图 Flowchart LR（含 HTML 标签）

```mermaid
flowchart LR
    A["客户端 <br/> fetch /git/status"] --> B{HTTP 200?}
    B -->|是| C["解析 JSON<br/>GitResult"]
    B -->|否| D["显示错误横幅"]
    C --> E["更新侧栏"]
```

## 3. 时序图 Sequence（loop / alt）

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
        W-->>U: 已保存 ✓
    else 失败
        W-->>U: 显示错误提示
    end
```

## 4. 类图 Class

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

## 5. 状态图 State v2

```mermaid
stateDiagram-v2
    [*] --> 编辑中
    编辑中 --> 已修改 : 输入内容
    已修改 --> 保存中 : 点击保存
    保存中 --> 已修改 : 失败
    保存中 --> 已保存 : 成功
    已保存 --> [*]
```

## 6. ER 图

```mermaid
erDiagram
    WORKSPACE ||--o{ TAB : contains
    TAB {
        string path
        string kind
    }
    WORKSPACE {
        string workspaceId
        string path
    }
```

## 7. 甘特图 Gantt

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

## 8. 饼图 Pie

```mermaid
pie title 语言占比
    "TypeScript" : 70
    "CSS" : 15
    "Markdown" : 15
```

## 9. 用户旅程 User Journey

```mermaid
journey
    title 打开工作区
    section 操作
      点击工作台图标: 3: 用户
      选择目录: 4: 用户
    section 加载
      等待文件树: 2: 系统
```

## 10. 思维导图 Mindmap

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

## 11. 时间线 Timeline

```mermaid
timeline
    title 版本历史
    0.1.1 : 首个版本
    0.1.7 : 升级检查
    0.1.8 : Markdown 图片
```

## 12. Git 图 Gitgraph

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

## 对照：普通代码块（非 mermaid，应始终显示为代码）

```text
graph TD
    A-->B
```

> 提示：如果上面所有 mermaid 块都只是代码块，说明当前预览**不支持 mermaid**；若部分支持部分不支持，可据此判断用的是哪个 mermaid 解析器（mermaid.js 8 / 9 / 10+ 对新语法支持不同）。
