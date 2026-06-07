# 墨改 · AI 小说转剧本工具

将 3 章以上的小说文本，借助 AI 自动转换为**结构化剧本（YAML）**，提供可对话迭代、可版本追溯的剧本创作工作台。本工具为纯前端应用，项目数据默认仅保存在当前浏览器本地 IndexedDB 中。AI 生成时，相关文本会发送到你配置的模型接口。请自行妥善保管 API Key，并定期导出重要剧本内容。视频演示：https://youtu.be/jA6URPPvoLU

## 功能特性

- **AI 章节切分**：粘贴整篇小说，AI 自动切分章节并生成简述，支持手动修改。
- **设定分析（Story Bible）**：自动抽取人物、地点、世界观，作为全局一致性依据，可逐项编辑确认。
- **逐章 / 批量生成**：勾选单章或多章，按设定的并发数批量生成剧本 YAML。
- **多种剧本风格**：影视剧 / 话剧 / 分镜脚本，可调对白密度、是否含旁白。
- **对话式编辑**：用自然语言指令修改剧本（"把第2场对白改得更紧张"），AI 改动以 diff 形式呈现，接受或拒绝。
- **类 Git 版本管理**：每次生成 / 修改自动提交，支持查看历史、对比 diff、回滚、分支。
- **实时 Schema 校验**：编辑器实时校验 YAML 是否符合剧本 Schema，生成时自动修复一次。
- **导出**：导出全本剧本 YAML。

## 技术栈

React + TypeScript + Vite + Monaco Editor + IndexedDB。无后端，项目数据保存在浏览器本地。

## 使用方式

直接打开已配置好的在线演示地址：

https://ximaohu-lmx.github.io/novel2script/

首次使用请点右上角「模型设置」，填入可用的模型接口信息和 API Key。

如需在本地运行，请使用 Node.js 18+ 执行：

```bash
npm install
npm run dev
```

打开终端提示的地址（通常是 `http://localhost:5173`）即可使用。

## 模型配置

- **OpenAI 兼容**（推荐）：填入 Base URL（如 `https://api.openai.com/v1`）、API Key、模型名。任何兼容 OpenAI `/chat/completions` 协议的端点均可。
- **Anthropic**：实验性支持，浏览器直连可能受 CORS 限制。

> API Key 仅保存在你本地浏览器的 localStorage，直连模型端点，不经过任何中间服务器。

## 文档

- [`docs/DESIGN.md`](docs/DESIGN.md)：整体设计文档（架构、Agent 编排、版本管理、对话编辑）。
- [`docs/SCHEMA.md`](docs/SCHEMA.md)：剧本 YAML Schema 定义与设计原因。

## 使用流程

1. 新建项目 → 粘贴小说原文 → AI 切分章节。
2. 确认章节 → AI 分析设定 → 编辑确认 Story Bible。
3. 选择剧本风格 → 逐章或批量生成 → 用对话 / 编辑器打磨 → 导出。
