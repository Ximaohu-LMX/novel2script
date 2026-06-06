# AI 小说转剧本工具 — 设计文档

> 将 3 章以上小说文本自动转换为结构化剧本（YAML），提供可对话迭代、可版本追溯的剧本创作工作台。

---

## 目录

1. [产品定位与核心流程](#一产品定位与核心流程)
2. [整体架构](#二整体架构)
3. [Agent 编排设计](#三agent-编排设计)
4. [版本管理（浏览器内类 Git）](#四版本管理浏览器内类-git)
5. [对话式编辑（类 Claude Code 体验）](#五对话式编辑类-claude-code-体验)
6. [前端界面设计](#六前端界面设计)
7. [技术选型](#七技术选型)
8. [剧本 YAML Schema 定义](#八剧本-yaml-schema-定义) — 见 docs/SCHEMA.md

---

## 一、产品定位与核心流程

纯前端网页应用，用户自带 API Key 配置模型（OpenAI / Anthropic / 兼容 OpenAI 协议的端点）。无后端，API Key 仅存浏览器本地，调用直连模型端点。

核心流程分四步：

```
粘贴文本 → 结构化分析（人物/场景/世界观）→ 用户确认&编辑 → 逐章/批量生成剧本(YAML) → 导出
```

**设计原则：人在回路（Human-in-the-loop）。** 每个 AI 阶段产出都是可编辑草稿，用户确认后才进入下一阶段，避免错误层层放大。生成后还可通过对话持续迭代，每次改动都进入版本历史，随时回滚。

---

## 二、整体架构

```
┌──────────────────────────────────────────────┐
│  前端 UI:三区工作台(时间线 / 编辑 / 对话)       │
│   + 文本输入 / 设定确认面板                     │
├──────────────────────────────────────────────┤
│  Agent 编排层                                  │
│   ChapterSplitter · BibleAgent ·               │
│   ConsistencyAgent · ScriptAgent ·             │
│   EditAgent · IntentRouter · Validator         │
├──────────────────────────────────────────────┤
│  版本引擎 VersionEngine                         │
│   commit / diff / branch / checkout            │
│   (纯 JS + IndexedDB)                          │
├──────────────────────────────────────────────┤
│  LLM 适配器(用户配置 API,流式输出)            │
├──────────────────────────────────────────────┤
│  本地存储 IndexedDB:                           │
│   项目 / 设定 / 提交树 / 会话线程               │
└──────────────────────────────────────────────┘
```

---

## 三、Agent 编排设计

采用 **流水线 + 共享上下文（Story Bible）** 模式。Story Bible 是全局一致性的真相来源，所有章节生成都引用它。

### Agent 清单

| Agent | 职责 | 输入 | 输出 | 调 LLM |
|---|---|---|---|---|
| ChapterSplitter | 切分章节 | 原文 | 章节数组 | 否(规则)/可选辅助 |
| BibleAgent | 抽取人物、场景、世界观设定 | 全文分块 | Story Bible 草稿 | 是 |
| ConsistencyAgent | 检测设定冲突、补全缺失 | Bible 草稿 | 校验报告 | 是 |
| ScriptAgent | 单章转剧本 | 章节文 + Bible | 章节 YAML | 是 |
| EditAgent | 对话式局部修改 | 当前 YAML + 指令 + Bible | 修改后 YAML | 是 |
| IntentRouter | 识别对话意图 | 用户消息 | 意图类型 | 是 |
| Validator | Schema 校验 | YAML | 通过/错误定位 | 否(规则) |

### 主流程编排（伪代码）

```
// 阶段 1:预处理
chapters = ChapterSplitter.split(rawText)   // 正则识别"第X章"等,失败则按长度+语义切

// 阶段 2:构建设定圣经(一次性,全局)
bible = BibleAgent.extract(chapters)         // map-reduce:分块抽取 → 合并去重
report = ConsistencyAgent.check(bible)
→ 【用户确认 & 编辑 Bible】← 关键人工节点

// 阶段 3:逐章生成(可单章 / 批量)
for chapter in selectedChapters:
    ctx = { chapter, bible, prevChapterSummary }  // 注入上下文保证连贯
    yaml = ScriptAgent.generate(ctx)
    Validator.validate(yaml)
    if invalid: ScriptAgent.repair(yaml, errors)  // 自动重试一次
    commit(yaml, author="ai")                     // 自动产生版本
→ 【用户编辑 / 对话迭代 / 重新生成单章】
```

### 关键编排技巧

**Map-Reduce 处理长文本。** BibleAgent 将全文分块抽取，再 reduce 合并同名人物、去重场景，规避上下文窗口限制。

**上下文滚动注入。** 生成第 N 章时，把第 N-1 章的剧情摘要 + 全局 Bible 一起传入，保证人物状态、伏笔连贯。摘要由前一章生成时附带产出，避免重复读全文。

**结构化输出约束。** ScriptAgent 的 System Prompt 强制输出符合 Schema 的 YAML，并附 few-shot 样例。生成后用 Validator 做硬校验，失败则带错误信息让模型自修复一次。

**批量生成的并发控制。** 批量时按用户设定的并发数（默认 2-3）并行调用，带速率限制与失败重试，UI 实时显示每章进度（待生成 / 生成中 / 完成 / 失败）。

---

## 四、版本管理（浏览器内类 Git）

> 纯前端无法运行真正的 Git，因此用 IndexedDB 自建版本图，实现 commit / diff / branch / 回滚 / 历史。体验与 Git 一致，无需后端。

### 数据模型

每个剧本项目维护一棵提交树：

```
Project
 ├── refs: { HEAD, branches{ main, draft-v2... } }
 ├── commits: [
 │     { id, parent, message, author(user|ai),
 │       timestamp, snapshot(全量YAML), diff }
 │   ]
 └── workingCopy: 当前编辑中的 YAML(未提交)
```

**提交粒度：** 每次"生成"或"用户手动保存"产生一个 commit。AI 生成的提交自动标记 `author: ai` 并带上触发它的对话消息；人工修改标记 `author: user`。

### 核心能力

| 能力 | 实现 | 对应 Git 概念 |
|---|---|---|
| 提交历史 | 提交树时间线，显示 message + 谁改的 | `git log` |
| 差异对比 | 行级 diff（jsdiff），YAML 分色渲染 | `git diff` |
| 回滚 | 切 HEAD 到某 commit，workingCopy 重置 | `git checkout` |
| 分支 | 同一章节开多个改编版本并行 | `git branch` |
| 对比版本 | 选两个 commit 并排 diff | `git diff a b` |

**分支的实际用途：** 作者想试"更黑暗的结局"又不想丢原版 —— 从当前 commit 开 `draft-dark` 分支，两版并存，满意了再合并 / 选定。

---

## 五、对话式编辑（类 Claude Code 体验）

对话不是重新跑整个流水线，而是由 **EditAgent** 做**局部精确修改**。

### 对话编辑编排流程

```
用户输入指令(如"第2场对白更紧张,加一句潜台词")
        ↓
IntentRouter 识别意图:full_regen | partial_edit | question
        ↓
┌─ partial_edit(最常见)──────────────────┐
│  EditAgent 输入:                         │
│   - 当前章节完整 YAML                     │
│   - 用户指令                              │
│   - Story Bible(保证人物一致)            │
│   - 对话历史(多轮上下文)                  │
│  输出:修改后的完整 YAML + 改动说明        │
└─────────────────────────────────────────┘
        ↓
Validator 校验 Schema → 失败自动修复一次
        ↓
生成 diff,在编辑区高亮,产生一个"待审阅"AI 改动
        ↓
用户:接受(commit) / 拒绝(丢弃) / 继续追加指令
```

### 编排关键点

**全量替换 vs 精准 patch。** 对剧本这种结构化文本，让模型**输出修改后的完整章节 YAML** 比让它输出 patch 更可靠（模型生成 diff 容易错行号）。diff 在前端本地用 jsdiff 算，只用于展示。

**接受 / 拒绝机制（类 Claude Code 的 diff 审阅）。** AI 改动先以"待审阅"状态叠加显示，用户点接受才正式 commit，拒绝则丢弃。这是人在回路的核心。

**对话上下文管理。** 每章维护独立会话线程，把"当前 YAML + Bible + 近几轮对话"作为上下文。会话过长时对早期消息做摘要，控制 token。

**指令落到选区。** 支持用户在编辑器里选中某场景 / 某段对白，再发指令，EditAgent 只改选中范围，精度更高（类似 Claude Code 选中代码再对话）。

**人工改 + AI 改的协同。** 用户手改后保存即产生 user commit；下次 AI 对话以最新 workingCopy 为基准，二者在同一提交树上交替，历史完整可追溯。

---

## 六、前端界面设计

### 三区式工作台（单章编辑）

```
┌──────────────┬─────────────────────┬──────────────┐
│  版本时间线   │   剧本编辑 / 预览     │   对话面板    │
│  (commit图)   │   (YAML + 渲染双视图) │  (chat)      │
│  ● user 手改  │                      │  用户:把第2场 │
│  ● ai 重生成  │   [diff 高亮显示      │  对白更紧张些 │
│  ● ai 初稿    │    AI 改了哪里]       │  AI: 已修改…  │
└──────────────┴─────────────────────┴──────────────┘
```

- **左 · 版本时间线：** commit 图，标记每次改动是 user 还是 ai，点击可查看 / 回滚 / 对比，支持分支切换。
- **中 · 主编辑区：** YAML 源码编辑器 + 渲染预览（场景标题、对白、动作分色）双视图切换；AI 改动以 diff 高亮叠加，待用户审阅。
- **右 · 对话面板：** 多轮对话迭代，流式显示生成过程，可选中编辑区内容再发指令。

### 其它阶段界面

- **文本输入：** 粘贴原文，自动分章并展示章节列表。
- **设定确认面板：** 人物卡片、场景列表、世界观，可增删改（对应 Story Bible）。
- **项目 / 章节列表：** 章节状态标记，支持单章生成、多选批量、全选。
- **设置面板：** Provider 选择、Base URL、API Key、模型名、最大并发、生成风格偏好（是否含旁白、对白风格、temperature 等）。

### 导出

单章 / 全本导出 `.yaml`，或打包 `.zip`。

---

## 七、技术选型

| 用途 | 选型 |
|---|---|
| 框架 | React + TypeScript |
| 代码编辑器 | Monaco Editor（YAML 高亮 + 校验 + DiffEditor 对比） |
| YAML 解析 | js-yaml |
| Schema 校验 | ajv + JSON Schema（YAML 转 JSON 后校验） |
| Diff 计算 | diff（jsdiff） |
| 版本图可视化 | @gitgraph/js 或自绘 SVG 时间线 |
| 本地存储 | IndexedDB（idb 库），刷新不丢失 |
| LLM 适配 | 统一接口封装，支持流式输出 |

---

## 八、剧本 YAML Schema 定义

剧本输出采用的 YAML Schema 定义、逐字段设计原因、字段说明表与完整示例，独立成文，见 [`SCHEMA.md`](SCHEMA.md)；机器可校验的 JSON Schema 见 [`schema.json`](schema.json)，应用内通过 ajv 实时校验生成结果。
