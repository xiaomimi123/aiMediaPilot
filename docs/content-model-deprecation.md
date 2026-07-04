# Content 模型边界诊断报告

**产出:** 2026-07-04 · P2-11 架构清理审计
**关联 commit:** `e8b8a52 refactor(architecture): P2 barrel + Platform 命名空间 + Json 读回 + 5 model deprecation`

---

## TL;DR

`Content` / `PublishTask` / `PublishTarget` / `Competitor` / `CompetitorNote` **5 个 model 在 src/ + tests/ 里零读写**,是 pivot 前留下的 dead schema。

**决定:** 加 `/// @deprecated` schema 注释,**不 DROP** 表(保数据 + 不动 migration)。
未来清理时,5 model 一起走一个 destructive migration,不要拆开做。

---

## 诊断方法

### 1. 检索所有 prisma 客户端读写点

```bash
grep -rn "prisma\.content\b\|prisma\.publishTask\|prisma\.publishTarget\|prisma\.competitor\|prisma\.competitorNote" src/ tests/
# → 0 hits
```

对照:`prisma.contentAnalysis` 有 40+ 处 hit — 说明 grep 正常,`prisma.content`(裸)确实无引用。

### 2. 检索裸 model 名 (可能出现在 type 层或 import)

```bash
grep -rn "\bContent\b|\bPublishTask\b|\bCompetitor\b" src/ tests/ \
  | grep -v "ContentAnalysis|contentAnalysis|ContentType|ContentStatus|content-analyze|content-retro|schema.prisma"
# → 0 hits (排除同名 helper 类型/文件后)
```

### 3. Prisma 关系诊断

`User` 有反向关系 `contents: Content[]` / `schedules: PublishTask[]` / `competitors: Competitor[]`,
但 grep `user.contents` / `user.schedules` / `user.competitors` → 0 hits。 
反向关系存在但从未被 include / select。

---

## 5 个 dead model 的原始意图 (pivot 前的 vision)

| Model | 原意图 | 现替代 |
|---|---|---|
| `Content` | AI 生成的通用发布内容 (笔记文案/视频脚本/标题/标签/封面) | `ScriptDraft` (脚本) + `ContentAnalysis` (视频预诊断) |
| `PublishTask` | 一键发布任务, `status`: DRAFT → PENDING_REVIEW → PUBLISHING → COMPLETED | pivot 明确"不做一键发布" (README.md#L15), 用户手动去平台发 |
| `PublishTarget` | 单个 `PublishTask` 在具体平台的 fan-out (适配后的 title/content/tags + retryCount) | 同上, 无消费方 |
| `Competitor` | 用户订阅的竞品账号 + `analysisResult` | `InspirationVideo` (用户手挑对标爆款 URL, 更贴近实际需要) |
| `CompetitorNote` | 竞品笔记时序观察 | 同上 |

**pivot 前 vs 现在的差异:**
- pivot 前:AI 大包大揽 → 生成 → 审核 → 一键多平台发布
- pivot 后 (README 定义):AI 只到生成为止 → 输出 platform-ready → 用户复制粘贴去发

原有的 `PublishTask` / `PublishTarget` 状态机(`DRAFT → PENDING_REVIEW → APPROVED → PUBLISHING → COMPLETED / PARTIAL_FAILED / FAILED`)是"发布 orchestration"的核心,pivot 后整条链失去意义。

---

## 为什么现在不 DROP

### 1. 未验证的数据存量

诊断时无 psql,未跑 `SELECT count(*)` 确认 5 表是否非空。单用户 MVP 大概率是空的,但:
- 老 `Content.userId` 关联 default-user, 假如早期做过 demo 数据 seed, DROP 会静默丢
- 用户 memory `project_view_prediction_reference.md` 提示项目对 pivot 决定较慎重

### 2. destructive migration 需要用户明确授权

`prisma migrate` 生成的 `DROP TABLE` 是不可逆动作。CLAUDE.md 层"Executing actions with care"要求这类操作显式确认,不该 agent 单方面推。

### 3. 5 表互相 FK

DROP 顺序有依赖:CompetitorNote → Competitor / PublishTarget → PublishTask → Content。
1 次 migration 一并 DROP 干净,分 5 次会互相 FK block。

### 4. 收益低

它们在 hot path 之外:
- Prisma client 生成的 model 定义只是 TypeScript 类型 + query builder, 未查询就没 runtime cost
- 表存在但空,DB 占用可忽略
- 唯一"污染"是 IDE 补全里出现 `prisma.content.*`,但概率低 (grep 已经证实过去没人误写)

---

## 现有的护栏 (P2 已落)

### schema.prisma 5 处 `/// @deprecated`

```prisma
/// @deprecated pivot 前的老通用发布模型。 2026-07 起没有 src/ 代码读写它。
/// 替代者: `ScriptDraft` (脚本生成产物) + `ContentAnalysis` (视频预诊断)。
/// 表和数据保留是为了不丢历史; 新代码不要再写这里。 未来清理时一起 DROP:
/// Content / PublishTask / PublishTarget / Competitor / CompetitorNote。
model Content { ... }
```

Prisma 会把 `///` 转成 `@deprecated` JSDoc,IDE 补全里 `prisma.content.create(...)` 会有删除线警告。 这是**主动阻断新代码误写**的最小成本手段。

---

## 未来 DROP 时机 & 流程

**触发条件 (三选一):**
1. 用户显式要求"清理老 schema"
2. 升级到多用户 SaaS 时(schema 变动大,顺手清)
3. 半年后仍无任何代码引用(TTL 保鲜期)

**推荐流程:**

```bash
# 1. 数据备份 — 5 表全量 dump
pg_dump $DATABASE_URL -t Content -t PublishTask -t PublishTarget -t Competitor -t CompetitorNote \
  > /tmp/dead_models_backup_$(date +%Y%m%d).sql

# 2. 确认无残留引用 (三个 grep 都返回 0)
grep -rn "prisma\.content\b\|prisma\.publishTask\|prisma\.publishTarget\|prisma\.competitor" src/ tests/
grep -rn "\bContent\b\|\bPublishTask\b\|\bCompetitor\b" src/ tests/ | grep -v Analysis  # 忽略 ContentAnalysis
grep -rn "ContentType\|ContentStatus\|PublishMode\|PublishStatus\|TargetPublishStatus" src/ tests/

# 3. 从 schema.prisma 里删 5 个 model + 4 个 enum (ContentType/ContentStatus/PublishMode/PublishStatus/TargetPublishStatus)
#    并从 User 里删 contents / schedules / competitors 反向关系

# 4. 生成 migration (destructive)
npx prisma migrate dev --name drop_deprecated_publish_models

# 5. 部署前 review migration.sql 里的 DROP TABLE 顺序 (Prisma 会自动处理 FK)
```

**注意:**
- `PlatformAccount.publishTargets` 反向关系也要删
- `enum` 一起清:`ContentType` / `ContentStatus` / `PublishMode` / `PublishStatus` / `TargetPublishStatus`

---

## 相关文件

- Schema: `prisma/schema.prisma` L266-L430 (5 model + 5 enum)
- P2 相关 commit: `e8b8a52`
- 依赖分析所用 grep: 见"诊断方法"section 1-3
