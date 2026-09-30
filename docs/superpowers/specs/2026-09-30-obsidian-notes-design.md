# 编导增强 · Obsidian 长期记忆设计（内置智能体子项目 3a）

- 日期：2026-09-30
- 状态：待用户审阅
- 前置：子项目 1 多模型接入、子项目 2 产品总助手已完成
- 后续：子项目 3b 联网搜索（单独 spec）

## 1. 目标

让编导和总助手用上用户在 Obsidian 里的积累，并把每条作品沉淀回 Obsidian：
- **读**：写稿时能搜、能读用户指定文件夹里的笔记，优先用用户自己的观点和经历；
- **写**：定稿、复盘后由产品提议把项目笔记存进 Obsidian 的专用文件夹，用户点确认才写。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 用途 | 读用户的积累 + 沉淀项目与复盘（不做"记住真实经历"与"记住偏好"） |
| 可读范围 | 默认 `5-灵感`、`3-资源`、`1-项目`，外加写入文件夹 `MediaPilot/`；设置页可改；未勾选的文件夹（如 `2-领域/人生`）一律不读 |
| 写入方式 | 编导提议、用户确认：对话里出现确认卡片，点「存进 Obsidian」才写 |
| 检索 | 关键词检索（标题 > 标签 / front-matter > 正文次数），不做向量检索 |
| 写入位置 | 只写 `MediaPilot/`；产品只改标记区块，用户在区块外的内容保留 |

## 3. 设置

`AppSetting` 新增：
- `obsidian.vault`：库路径。未设置时从 `~/Library/Application Support/obsidian/obsidian.json` 读取（取 `open: true` 的那个，否则第一个）。
- `obsidian.readFolders`：JSON 字符串数组，库内相对路径；默认 `["5-灵感","3-资源","1-项目"]`。

写入文件夹固定为 `MediaPilot`（总是可读）。

设置页新增「Obsidian」卡片：
- 库路径（显示自动识别结果，可改，保存前检查目录存在且含 `.obsidian`）；
- 可读文件夹：列出库的顶层文件夹（跳过以 `.` 或 `_` 开头的），勾选；已勾选但不存在的标红"找不到"；
- 写入文件夹：只读显示 `MediaPilot/`；
- 状态：可读笔记数量，或读不到的原因。

## 4. 读：检索与读取

核心逻辑在 `src/lib/notes/`：
- **路径安全**：所有路径先 `realpath` 解析，必须落在"库根 + 可读文件夹"之内，否则拒绝；跳过任何以 `.` 开头的目录；只认 `.md`。
- **扫描**：每次检索遍历可读文件夹，按文件修改时间缓存正文（进程内缓存）。
- **`searchNotes(query, limit = 8)`**：把 query 按空白拆成关键词；每篇得分 = 标题命中 ×5 + 标签 / front-matter 命中 ×3 + 正文命中次数（每词最多计 5）；得分 > 0 的按得分、再按修改时间排序；返回 `{ path, title, snippet, mtime }`，snippet 为第一个正文命中处前后共约 120 字。
- **`readNote(path)`**：返回全文，超过 6000 字截断并注明"（已截断，全文 N 字）"。

工具（编导 `SCRIPT_TOOLS` 追加）：
- `search_notes({ query })`、`read_note({ path })`；库找不到时返回失败，summary 为 `没找到 Obsidian 库：去设置页填库路径`。

命令行（总助手因此自动获得同名工具）：
- `mp notes search <关键词…>`、`mp notes show <路径>`；tier `read`，`hermes: false`（笔记不给微信那边）。

编导系统提示新增规则：
- 写稿前如果这个选题可能在用户笔记里有积累，先 `search_notes`，优先用用户自己的观点、案例和经历；
- 稿子是口播，正文里不写 `[[ ]]`；在对话回复里说明借用了哪篇，如"开场的例子来自 [[笔记名]]"；
- 不拿笔记去编造【待补】处的经历，只引用笔记里真实写着的内容。

## 5. 写：提议与确认

### 5.1 数据

```prisma
/// 存进 Obsidian 的提议(用户确认才写)
model NoteProposal {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  /// finalize | retro | manual
  trigger   String
  /// 库内相对路径, 如 MediaPilot/项目/xxx.md
  path      String
  /// 标记区块内的内容(预览即写入内容)
  content   String   @db.Text
  /// pending | written | rejected | expired
  status    String   @default("pending")
  error     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([projectId, status])
}
```

### 5.2 何时提议

- **定稿**：`finalizeScript` 把阶段从 draft 推进到 scripted 时，建一条提议（trigger `finalize`）。
- **复盘**：`generateRetro` 成功生成或更新复盘时，建一条提议（trigger `retro`）。
- **手动**：编导工具 `propose_note({ summary? })`（用户说"把这条存进笔记"时调用），trigger `manual`。

建提议时：同一项目其它 `pending` 的提议改为 `expired`；在项目对话里写一行 `role: 'system'`、`toolName: 'note:proposal'`、`toolResult: { ok: true, proposalId }`、内容"要把这个项目存进 Obsidian 吗？"。建提议失败（如库找不到）不影响定稿与复盘本身。

### 5.3 笔记内容

全部由产品数据拼出，不让模型生成：

```markdown
---
mediapilot_id: <项目 id>
stage: <阶段>
updated: <YYYY-MM-DD>
tags: [mediapilot]
---
<!-- mediapilot:start -->
# <项目标题>

## 选题
<来自对标拆解的选题；没有对标时写项目标题>

## 对标
<作者 · 点赞（平时的 N 倍） · 链接>（没有则省略本节）

## 定稿
### 开场钩子
<正文>
…（6 段）

## 复盘
### 第 3 天 · 播放 N · 点赞 N
- 差 开头 2 秒：…
编导解读：…
### 第 7 天 …（有才写）

## 写法经验
- <经验>（已采纳 / 待决定 / 不要）

## 编导小结
<propose_note 的 summary；没有则省略本节>
<!-- mediapilot:end -->
```

文件名：`MediaPilot/项目/<标题去掉 / \ : * ? " < > | 后>.md`；该文件已存在且 front-matter 的 `mediapilot_id` 不是本项目时，文件名追加 `-<项目 id 后 6 位>`。

### 5.4 确认卡片

- 项目对话里 `note:proposal` 行渲染为卡片：标题、写入位置、可展开的全文预览、「存进 Obsidian」「不要」；状态非 pending 时显示"已存进 Obsidian / 已不要 / 已过期"，按钮不可点。
- 接口：`GET /api/notes/proposals/[id]`（预览）、`POST /api/notes/proposals/[id]` body `{ action: 'accept' | 'reject' }`。
- **写入**：
  - 目标文件不存在：写 front-matter + 区块；
  - 已存在且有标记区块：只替换区块内内容、更新 front-matter 的 `stage`、`updated`，区块外原样保留；
  - 已存在但没有标记区块（用户手建的同名笔记）：换用追加 id 的文件名，不动用户文件；
  - 先写同目录临时文件再 `rename`；自动建 `MediaPilot/项目/`。
- 成功 → `written`；失败 → 保持 `pending`，`error` 记录中文原因，卡片显示。

## 6. 出错处理

| 场景 | 行为 |
|---|---|
| 没找到库 / 路径变了 | 读取工具返回"没找到 Obsidian 库：去设置页填库路径"；提议照建，点「存进」时报同样的原因，提议保持 pending |
| 可读文件夹被删 | 检索时跳过；设置页标红 |
| 路径越界（`..`、符号链接指向外部、未勾选文件夹） | 拒绝："这篇笔记不在允许读取的文件夹里" |
| 写入失败（权限等） | 卡片显示原因，提议保持 pending，可再点 |
| 提议已过期 / 已处理 | 接口返回 409 "这个提议已经处理过了" |

## 7. 测试与验收

- 单元（全部用临时目录造的假库，不读真实笔记——仓库公开）：路径越界与隐藏目录拦截；检索打分与排序、snippet；截断；笔记内容拼装（有 / 无对标、有 / 无复盘）；区块替换保留区块外内容；同名文件（他人 / 用户手建）换名；提议新旧过期；定稿与复盘触发建提议且失败不影响主流程；卡片渲染与按钮状态。
- 真机：①在 `5-灵感` 里搜一个写过的词；②让编导写一条借用笔记的稿，回复里注明来源；③测试项目定稿 → 出现卡片 → 存进 → Obsidian 里看到笔记；在区块外加一句话，再次存进后那句话仍在；④总助手里 `notes_search` 可用。

## 8. 不做

向量检索；写 `MediaPilot/` 以外的地方；读未勾选文件夹；Obsidian 改动回流到产品；让模型生成笔记正文；联网搜索（子项目 3b）。

## 9. 真机实测（2026-09-30，实施后，当前模型 DeepSeek）

- 设置页：自动识别库路径，默认勾选 5-灵感 / 3-资源 / 1-项目，可读 109 篇；勾选 Clippings 变 112 篇，取消后恢复。顶层文件夹列表不含 `.obsidian`、`_模板` 等。
- `mp notes search`：AI / 剪辑 / 抖音 / Claude 各返回 8 篇（上限）；`MP_AGENT=hermes` 调用被拒。
- 编导：让它写"用 AI 剪辑视频"的稿，先后 2 次 search_notes、2 次 read_note，回复里用 `[[笔记名]]` 注明借用了哪两篇，真实经历处仍留【待补】。
- 定稿：点「定稿」后对话里立刻出现卡片（实施中发现项目页只在转写任务运行时轮询，已改为定稿后刷新一次）；点「存进」后 `MediaPilot/项目/Obsidian验收测试.md` 写入，含 front-matter 与标记区块。
- 手动提议：在区块外加一行后让编导 propose_note（带小结）并确认，新笔记含「编导小结」，区块外那行仍在；再次确认同一提议返回 409。
- 总助手："我的笔记里有几篇提到 Remotion" → 调用 notes_search。
