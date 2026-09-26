# 自媒体工作台重定位 — 设计文档

日期: 2026-08-03
状态: 已与用户逐段确认

## 1. 背景与定位

MediaPilot 从「给小白的向导式智能体」重定位为「给自己（全平台发展的自媒体博主）用的日常创作工作台」。

- **用户**: 自己为主（AI 知识类抖音博主），保留未来扩展给其他博主的可能（userId 隔离等 SaaS 预留不删）。
- **覆盖环节**: 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据/复盘,完整创作闭环。
- **平台策略**: **主阵地 + 分发登记**。抖音是主阵地（创作闭环 + 预测 + 复盘全在这里）；其他平台（B站/YouTube/推特/小红书/公众号/快手/微博…）只登记「这条内容分发到了哪」,不做独立创作流。
- **不做**: 一键发布、拖拽改状态、SaaS 计费（本期范围外）。

## 2. 数据模型与内容状态机

### 2.1 内容主线 = ScriptDraft

`ScriptDraft` 概念上升级为「内容卡」,是管线看板的基本单元。**阶段不新增字段,按现有数据派生**,避免双写不一致：

| 阶段 | 判定规则 |
|---|---|
| 📝 草稿 | `picked == null` |
| ✅ 定稿待拍 | `picked != null` 且 `analysisId == null` |
| 🎬 已拍待发 | `analysisId != null` 且未发布 |
| 🚀 已发布 | `analysis.publishedAt != null` **或** 存在任一 Distribution 记录 |
| 📊 已复盘 | `analysis.retroStatus == COMPLETED` |

派生逻辑抽成纯函数 `deriveStage(draft, analysis, distributions)`（放 `src/lib/` 下,单测覆盖每个分支）。

新增显式字段：`ScriptDraft.archivedAt DateTime?` — 放弃的内容移出看板,不删数据。

没链接 ScriptDraft 的孤儿 `ContentAnalysis`（直接上传视频分析的老数据）也进看板,从「已拍待发」列起算。

### 2.2 新模型 TopicIdea（选题池）

目前「零输入主题发现」(discover) 和灵感洞察 (inspiration) 的产出看完即走、不落库。新增：

```prisma
model TopicIdea {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  title         String
  note          String?
  source        String    // 'discover' | 'inspiration' | 'manual'
  status        String    @default("POOL") // 'POOL' | 'ADOPTED' | 'DISCARDED'
  scriptDraftId String?   // 采纳后链到草稿
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId, status, createdAt])
}
```

### 2.3 新模型 Distribution（分发登记）

```prisma
model Distribution {
  id            String    @id @default(cuid())
  scriptDraftId String
  scriptDraft   ScriptDraft @relation(fields: [scriptDraftId], references: [id], onDelete: Cascade)
  platform      String    // 平台 key,见 2.4 注册表
  url           String
  publishedAt   DateTime  @default(now())
  note          String?
  createdAt     DateTime  @default(now())

  @@index([scriptDraftId])
}
```

- 抖音主阵地发布仍走现有 `ContentAnalysis.douyinUrl`（喂 retro / L1 预测管线）。
- Distribution 管其他平台的搬运登记；没走视频分析直接发的内容可用 `platform='douyin'` 的 Distribution 兜底登记（不参与 retro）。

### 2.4 平台注册表（代码配置,非 DB enum）

现有 `Platform` enum 缺 YouTube/推特且扩展要改 schema。分发平台改为代码注册表 `src/lib/platform-registry.ts`：

```ts
export const DISTRIBUTION_PLATFORMS = [
  { key: 'douyin',      label: '抖音',   color: '...' },
  { key: 'bilibili',    label: 'B站',    color: '...' },
  { key: 'youtube',     label: 'YouTube',color: '...' },
  { key: 'twitter',     label: 'X/推特', color: '...' },
  { key: 'xiaohongshu', label: '小红书', color: '...' },
  { key: 'gongzhonghao',label: '公众号', color: '...' },
  { key: 'kuaishou',    label: '快手',   color: '...' },
  { key: 'weibo',       label: '微博',   color: '...' },
] as const
```

加新平台 = 加一行配置。未知 key 的历史数据 UI 上原样显示 key,不崩。

### 2.5 不动的部分

- deprecated 模型（Content / PublishTask / PublishTarget / Competitor / CompetitorNote）继续不动,未来统一 DROP。
- 视频分析 / L1 预测 / retro / auto-sync 管线全部保留,不改逻辑。
- 多平台生成 prompts（小红书/公众号）保留,作为创作流里的可选项。

## 3. IA 与页面结构

### 3.1 Sidebar 重组（5 项）

```
🏠 工作台   → /            [新首页]
🪄 创作     → /agent       [现有向导 + discover + inspiration 归入]
📚 内容库   → /content     [现有 scripts + 分析列表]
📊 数据     → /dashboard   [现有 7 widget 不动]
⚙️ 设置     → /settings
```

现有路由全部保留可访问（向后兼容）,只改导航入口。

### 3.2 新首页 `/`（替换现有引导页）

**上半屏「今日驾驶舱」**：
- 五个阶段计数（选题池 N / 草稿 N / 定稿待拍 N / 已拍待发 N / 已发待复盘 N）,每个可点击跳到对应看板列或列表。
- 右侧最近 7 天数据摘要（复用 dashboard 现有 API,不新写聚合）。
- 「抓灵感」快捷入口 → /agent/discover。

**下半屏「内容管线看板」**：
- 六列：选题池 → 草稿 → 定稿待拍 → 已拍待发 → 已发布 → 已复盘。
- 每条内容一张卡：标题 / 平台徽标 / 分发数 / 停留天数；「已发布」列卡片显示复盘倒计时（T+N 天）。
- 点卡进详情页（script 详情或 analysis 详情,现有页面）。
- **第一版不做拖拽**——状态由真实动作驱动（定稿=选版本、已拍=传视频、已发=登记链接）,拖拽会制造假状态。
- 已复盘列只显示最近的若干条,归档的卡不显示。

## 4. 关键交互流

1. **选题入池**: discover / 灵感页每个推荐主题加「+ 入选题池」按钮；驾驶舱可手动快速添加。池中选题点「开写」→ 带 topic 跳 /agent 生成 → 生成成功后该选题标记 ADOPTED 并写入 scriptDraftId。
2. **分发登记**: 内容详情页 + 看板卡片「+ 登记分发」→ 弹窗选平台（注册表）+ 贴 URL → 卡片显示「已分发 N 平台」徽标。
3. **复盘闭环**: 现有 retro / auto-sync 不动；看板已发布列显示复盘倒计时,复盘完成的卡自动流入最后一列。

## 5. 分阶段实施

| 阶段 | 内容 | 量级 |
|---|---|---|
| **A** | 数据层: TopicIdea + Distribution + archivedAt schema、`deriveStage` 纯函数、平台注册表、CRUD API + 单测 | ~1 天 |
| **B** | 工作台首页: 驾驶舱 + 看板 + sidebar IA 重组 | ~1 天 |
| **C** | 交互流: 选题入池按钮、分发登记弹窗、卡片徽标、复盘倒计时 | ~0.5 天 |
| **D**（可选） | 旧引导页清理、README / 文档更新收尾 | ~0.5 天 |

每阶段独立可发布。

## 6. 错误处理与边界

- `deriveStage` 对缺失数据（analysis 被删、picked 结构异常）一律降级到更早阶段,不抛错。
- Distribution URL 只做基本格式校验（http(s) 开头）,不做平台侧存在性校验。
- 看板 API 一次查询拼装（drafts + analyses + distributions 三表 join / 分组）,避免 N+1（此前 dashboard 有过 N+1 教训,见 a0302bf）。
- 选题池重复入池：同 title 已在 POOL 时提示而非重复创建。

## 7. 测试策略

沿用项目约定：
- `deriveStage` 每个分支 + 边界（孤儿 analysis、archived、双通道发布）单测。
- TopicIdea / Distribution CRUD API 单测（mock prisma）。
- 看板聚合 API 单测（3 表数据组合 case）。
- UI 手动 E2E（有意识的取舍,与现状一致）。
