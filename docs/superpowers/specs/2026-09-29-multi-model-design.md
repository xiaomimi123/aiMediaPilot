# 多模型接入设计（内置智能体子项目 1）

- 日期：2026-09-29
- 状态：待用户审阅
- 背景：用户要在产品里内置一个能接任意大模型的智能体，拆成三个子项目：① 多模型接入（本文）→ ② 产品总助手（含 skill 机制，工具复用 `mp` 命令注册表）→ ③ 编导增强（Obsidian 长期记忆 + 联网搜索）。方案 A：模型层可换、智能体循环沿用自研，不嵌入第三方智能体框架，也不把 Hermes 打包进产品（Hermes 继续通过 `mp` 命令行做外部搭档）。

## 1. 目标

- 设置页能添加任意厂商的模型（国产模型、Claude、本地 Ollama、中转站），全局选一个当前使用，想换就整体切换。
- 编导对话、写稿工具、拆解、复盘、找选题、发布文案、转写校对、每晚巡检里的拆解与复盘、`mp` 命令行——全部改用"当前模型"，不再写死 DeepSeek。
- 测试不只测连通，还测**工具调用**与**结构化输出**，告诉用户这个模型能不能当编导。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 分配粒度 | 全局一个模型 |
| 要接的模型 | 国产模型、Claude、本地模型 / 中转平台 |
| 技术方案 | A1：两种接口类型——OpenAI 兼容（沿用现有 `openai` 库，改成可配地址）+ Claude 原生（新增 `@anthropic-ai/sdk` 适配）；不引入 Vercel AI SDK 等框架 |
| 配置存放 | 数据库新表；key 只在界面显示末 4 位、接口不回传完整 key |
| 迁移 | 首次启动无配置且 `.env` 有 `DEEPSEEK_API_KEY` → 自动建"DeepSeek"并设为当前 |

## 3. 数据

```prisma
/// 大模型配置(多条, 同时只有一条 isActive)
model ModelProvider {
  id         String   @id @default(cuid())
  name       String
  /// openai | anthropic
  kind       String
  baseUrl    String
  apiKey     String   @default("")
  model      String
  isActive   Boolean  @default(false)
  /// { at, reachable, tools, json, message } 最近一次测试
  lastTest   Json?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

预设（只预填接口地址与类型，模型名由用户填）：

| 预设 | 类型 | 接口地址 |
|---|---|---|
| DeepSeek | openai | `https://api.deepseek.com/v1` |
| 通义千问 | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Kimi | openai | `https://api.moonshot.cn/v1` |
| 智谱 GLM | openai | `https://open.bigmodel.cn/api/paas/v4` |
| 豆包（火山方舟） | openai | `https://ark.cn-beijing.volces.com/api/v3` |
| OpenRouter | openai | `https://openrouter.ai/api/v1` |
| Ollama（本地） | openai | `http://localhost:11434/v1`（key 可空） |
| Claude 官方 | anthropic | `https://api.anthropic.com` |
| 自定义 / 中转站 | 任选 | 用户填 |

预设地址在实施时逐个核对官方文档；核对不了的标"请以厂商文档为准"。

## 4. 代码结构

- `src/lib/llm/provider.ts`：`getActiveModel(db) → { chat: ChatModel; llm: StructuredLLM; label: string } | null`；`buildModel(config)`（按 kind 建适配）；`ensureMigrated(db)`（从 `.env` 迁移，只做一次）。
- `src/lib/llm/openai-compatible.ts`：由 `createDeepSeekChatModel` 泛化（地址 / key / 模型名）；结构化输出沿用 `OpenAIVisionLLM` 的 JSON 模式 + zod 校验；没有工具时不传 `tools`。
- `src/lib/llm/anthropic.ts`：
  - 对话：把 OpenAI 格式的消息（system / user / assistant 含 tool_calls / tool 结果）转成 Anthropic 格式（system 单独、`tool_use` / `tool_result` 块、同角色合并），`messages.stream` 流式输出文字，收集 `tool_use` 转成现有 `ToolCall`。
  - 结构化：强制调用一个参数即目标 schema 的工具（`tool_choice`），取参数后用同一 zod schema 校验。
- `src/lib/llm/model-test.ts`：三项测试（连通 / 工具调用 / 结构化输出）→ `able_agent` / `analysis_only` / `unusable` + 中文说明。
- `src/lib/llm/errors.ts`：把厂商报错（401/403、402/余额、429、404 模型不存在、连不上、Ollama 未运行、模型不支持工具）翻成中文，并带上模型名。
- 调用点：`src/app/api/projects/[id]/chat`、`…/publish/kit`、`src/app/api/topics/suggest`、`src/lib/benchmark/deps.ts`、`src/lib/recording/deps.ts`、`src/lib/retro/generate.ts`、`src/lib/cli/commands/{chat,read,write}.ts` 全部改为 `getActiveModel`。
- 命令行：错误码 `no_deepseek_key` → `no_model`（"还没有可用的模型：去设置页添加"）；skill 说明同步。
- 设置页：「DeepSeek key」卡片换成「模型」卡片；体检项"DeepSeek key"换成"当前模型"（显示名称与最近测试结果）。
- `.env` 的 `DEEPSEEK_API_KEY` 只在迁移时读取一次。

## 5. 界面

「模型」卡片：
- 列表：显示名、类型、模型名、key 末 4 位、最近测试结果（能当编导 / 只能做分析 / 不可用 / 未测试）、当前使用标记。
- 添加 / 编辑：选预设 → 填 key、模型名（可改地址与显示名）→ 保存。
- 每条：「测试」「设为当前」「编辑」「删除」。
- 「设为当前」时最近测试不是"能当编导"→ 确认框："这个模型写稿改稿会失败，确定切换吗？"。
- 删除当前使用的模型 → 变为"没有可用的模型"，不自动换。

## 6. 出错处理

| 场景 | 行为 |
|---|---|
| 没有当前模型 | "还没有可用的模型：去设置页添加"（网页、命令行、每晚任务一致） |
| key 无效 / 余额不足 / 限流 / 模型名不对 / 连不上 | 中文原因 + 怎么办，带模型名 |
| Ollama 未运行 | "连不上本地模型：先运行 Ollama" |
| 模型不支持工具调用 | 编导一轮失败并说明"当前模型不支持工具调用，写稿改稿用不了，换一个能当编导的模型" |
| 当前模型被删 | 没有可用模型，提示去设置 |

## 7. 测试与验收

- 单元：两种接口的消息转换（系统提示 / 工具调用 / 工具结果 / 多轮合并）；Claude 流式拼接；Claude 结构化输出；三项测试判定；迁移只做一次；key 掩码；报错翻译。
- 回归：编导、写稿、拆解、复盘原有测试全绿（对话循环不改）。
- 真机：① 迁移后 DeepSeek 为当前、编导与拆解正常；② 测试 DeepSeek 三项全过；③ 用户提供 Claude key（或能用 Claude 的中转站）后添加、测试、设为当前、让编导写一版；④ 若装了 Ollama，添加本地模型看测试结果。

## 8. 不做

按用途分配模型；失败自动切换备用模型；Gemini 原生接口；视觉；用量与费用统计。

## 9. 预设核对与真机实测（2026-09-29，实施后）

- 预设地址核对：通义千问（国内站 `dashscope.aliyuncs.com/compatible-mode/v1`，国际站 `dashscope-intl…`）、Kimi（国内站 `api.moonshot.cn/v1`，国际站 `api.moonshot.ai/v1`）、智谱 GLM（`open.bigmodel.cn/api/paas/v4`）、豆包（`ark.cn-beijing.volces.com/api/v3`）与官方文档一致；两个分国内/国际站的在预设说明里注明。DeepSeek、OpenRouter、Ollama、Claude 为各自公开的标准地址。
- 迁移：首次启动从 `.env` 建出"DeepSeek（deepseek-chat）"并设为当前；设置页「测试」三项全过 → 能当编导；体检"当前模型"为绿；接口返回不含 key。
- 本机未装 Ollama，本地模型验收跳过。
- Claude 真机：待用户提供 key 后补。

