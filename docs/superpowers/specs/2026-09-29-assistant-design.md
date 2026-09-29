# 产品总助手设计（内置智能体子项目 2）

- 日期：2026-09-29
- 状态：待用户审阅
- 前置：子项目 1 多模型接入已完成（`getActiveModel`）；`mp` 命令注册表已完成（`src/lib/cli`）
- 后续：子项目 3 编导增强（Obsidian 长期记忆、联网搜索）

## 1. 目标

侧栏新增「助手」：一个跨项目的对话入口，能
- **问状态和数据**："今天有什么爆款""上周那条复盘怎么样""昨晚回采成功没"；
- **一句话开工**："找个选题帮我建项目并写第一版稿"——串起找选题 → 建项目 → 项目编导写稿；
- **出主意、讨论**："我最近数据下滑，该怎么调整"——结合定位、复盘、写法经验、对标给建议。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 做事前是否确认 | 都直接做（硬护栏照旧：抖音只读、每日额度、定稿不倒退） |
| skill 来源 | 只做内置 3 个 |
| 入口 | 左侧栏独立页面 `/assistant` |
| 技术方案 | 复用编导的对话循环（范围可替换）；工具从 `mp` 命令注册表自动转换 |
| 模型 | 设置页的当前模型（与编导共用） |

## 3. 对话循环的范围化

`runAgentTurn` 目前绑定项目：用户消息、回复、工具行写进 `ChatMessage(projectId)`，系统提示与历史按项目读。改为注入一个"对话范围"：

```ts
interface ConversationScope {
  buildSystemPrompt(): Promise<string>;
  loadHistory(): Promise<AgentMessage[]>;
  save(m: { role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolName?: string; toolInput?: unknown; toolResult?: unknown }): Promise<void>;
}
```

- 项目编导：`projectScope(db, projectId)`，行为与现在完全一致（原有测试全绿）。
- 总助手：`assistantScope(db, threadId)`。
- 其余逻辑（工具执行、调用上限 8 次工具 / 10 次模型、报错翻译、流式事件）不变。

## 4. 工具：命令注册表 → 助手工具

- 每条命令转成一个工具：名字 = 命令路径用下划线连接（`status`、`topics_hits`、`project_new`、`chat`…），说明 = 命令 `summary` + `usage`，参数：

```ts
{ args?: string[]; flags?: Record<string, string | boolean> }
```

- 执行：拼成与命令行相同的 `Parsed`，调用命令的 `run`，结果用命令的 `format` 转成中文文本交回模型（同时保留 JSON 数据）；命令抛出的中文错误原样交回。
- 身份按 `claude-code`（全部权限），但**排除**：出片（`film new/check/render/register`、`project export`）、`agents install-hermes`。
- "一句话开工" = `topics_suggest` → `project_new --from-video …` → `chat <项目> "写第一版…"`；`chat` 会运行该项目的编导，稿子与对话写进那个项目。

## 5. 数据

```prisma
/// 总助手的对话
model AssistantThread {
  id        String             @id @default(cuid())
  /// 取第一句用户消息的前 30 字
  title     String             @default("新对话")
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
  messages  AssistantMessage[]
}

model AssistantMessage {
  id         String          @id @default(cuid())
  threadId   String
  thread     AssistantThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  /// user | assistant | tool | system
  role       String
  content    String          @db.Text
  toolName   String?
  toolInput  Json?
  toolResult Json?
  createdAt  DateTime        @default(now())

  @@index([threadId, createdAt])
}
```

## 6. 系统提示

依次包含：
1. 角色与规则：你是用户的抖音创作总助手；用工具查数据、做事，做完用一两句话说明做了什么；只引用工具给的数据，不编数字和原因；需要固定流程时先 `load_skill`；用户问的事工具做不到就直说（例如出片要在 Claude Code 里做）；回复中文、简短。
2. 定位摘要（人设 `systemSummary`，没有则各字段摘要）。
3. 账号概况（`mp status` 的中文输出）。
4. 已生效的写法经验（最多 10 条）。
5. 内置 skill 清单（名字 + 一句话说明）。

## 7. skill 机制

- 位置：`assistant/skills/<名字>/SKILL.md`（入库），格式同 Claude Code / Hermes：YAML 头 `name`、`description`，正文为步骤。
- 工具 `load_skill({ name })`：返回正文；名字不存在 → 返回可用 skill 列表。
- 对话里显示一行"已使用 skill：<名字>"。
- 内置 3 个：
  1. **daily-kickoff（每日开工）**：`status` → 有失败先说原因与补救 → `topics_hits --days 1`、`publish_candidates`、`lessons_list` → "今天建议做什么"最多 3 条，每条带可直接执行的下一步。
  2. **benchmark-to-draft（从对标到首版稿）**：确定一条爆款（用户指定或 `topics_suggest` 里第一条）→ `project_new --from-video` → `chat` 写第一版（带用户角度）→ `project_show` → 汇总要点、时长、照抄提示与项目链接。
  3. **data-diagnosis（数据诊断）**：`status` → 近期 `retro_show`（逐个已发布项目）→ `lessons_list` → `topics_hits` → 说出看到的共同点，给 2–3 条具体调整；只引用数据，不编原因；数据不足就说数据不足。

## 8. 页面 `/assistant`

- 左：对话列表（标题、更新时间，新→旧）+「新对话」；窄屏收成下拉框。
- 右：对话流，与项目对话框同一套样式——流式回复；每次工具调用一行（✓/✗ + 中文一句，可展开看原始输出）；"已使用 skill"行；回复与工具结果中的项目 id / 对标作品 id 渲染成可点链接（`/projects/<id>`、`/topics`）。
- 输入框下 3 个快捷按钮："今天做什么"、"找个选题开工"、"最近数据怎么样"。
- 侧栏在「项目」后加「助手」。

## 9. 出错处理

| 场景 | 行为 |
|---|---|
| 没有可用模型 | 页面提示 + 设置页链接 |
| 当前模型不支持工具调用 | 检测到该报错时本轮去掉工具重试一次（纯聊天回答），并在回复前加一行提示"当前模型只能聊天，不能帮你操作产品，换一个能当编导的模型" |
| 工具失败 | 命令的中文错误原样交给模型，由它转告原因与下一步 |
| 调用次数到上限 | 沿用编导规则，停下并如实说明进展 |
| 对话很长 | 只带最近 20 条进上下文；页面仍显示全部 |

## 10. 测试与验收

- 单元：命令 → 工具（排除项不在列表、参数错误返回中文）；skill 解析与 `load_skill`（含不存在的名字）；系统提示包含定位 / 概况 / 经验 / skill 清单；范围化后编导原有测试全绿；页面组件（对话列表、工具行、链接渲染、快捷按钮）。
- 真机：①"今天做什么"按 skill 查数据并给 3 条建议；②"找个选题开工"——数据不足如实说明，数据够则建项目并写首版，点链接能看到稿子（测试项目用完问用户是否删除）；③"最近数据怎么样"不编原因；④换成只能聊天的模型时提示正确。

## 11. 不做

用户自己写 / 编辑 skill；导入 Claude Code / Hermes 的 skill；助手自己总结 skill；悬浮窗；长期记忆（子项目 3）；联网搜索；出片；语音。
