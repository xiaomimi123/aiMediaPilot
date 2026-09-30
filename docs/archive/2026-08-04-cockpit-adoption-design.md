# Creator Cockpit 整体移植设计

**日期:** 2026-08-04
**来源项目:** [AverrryHu/creator-cockpit](https://github.com/AverrryHu/creator-cockpit) v1.5.0, MIT 协议
**决策背景:** 用户认可 creator-cockpit 的纸质编辑部 UI 风格与操作台交互逻辑, 决定将其 **UI 组件 + 交互逻辑整体复制** 进 MediaPilot, 与我们已有的强能力 (爬虫 auto-sync / AI 脚本生成 / L1 预测 / calibration) 结合, 不重复造轮子。

## 0. 已确认的四个关键决策

| 决策点 | 结论 |
|---|---|
| 移植深度 | 组件与操作逻辑整体复制, 不只搬设计 tokens |
| 数据底座 | 正规 Prisma 建模接数据库 (不用 IndexedDB / 不用 JSON blob) |
| IA 整合 | cockpit 侧栏接管全站外壳, 现有页面挂入壳内 |
| 阶段体系 | 原样保留 cockpit 8 阶段, 存量数据一次性迁移 |

## 1. 总体架构

creator-cockpit 的全部业务逻辑 (`app/lib/workflow.ts` 452 行 / `schedule.ts` / `calculations.ts`) 是「输入 `WorkspaceState` → 输出新 `WorkspaceState`」的纯函数, 与存储解耦。移植策略:

- **纯逻辑层零改动复制** (连同它的测试一起搬)。
- **只替换存储层**: 把「IndexedDB 读写」(`storage.ts`) 换成「从 MediaPilot API 加载 / 防抖保存」。
- **视图层复制 + 拆文件**: 原 `Cockpit.tsx` 为 2548 行单文件, 复制时按视图拆分为多个组件文件 (灵感池 / 今日·本周 / 档期 / Pipeline / 大目标 / 复盘实验室 / 内容抽屉 / 共享小组件), **逻辑一字不改, 只拆文件**。

### 技术兼容性

| 差异 | cockpit | MediaPilot | 对策 |
|---|---|---|---|
| React | 19 | 18.3 | 组件只用标准 hooks, 预期兼容; 个别不兼容写法做最小语法适配, 不改行为 |
| Next | 16 (vinext) | 14.2 | 只搬客户端组件与纯逻辑, 不搬构建配置 |
| Tailwind | 4 | 3 | `globals.css` 实为纯 CSS 变量体系, 去掉 `@import "tailwindcss"` 后原样可用 |

## 2. 数据层 (Prisma 建模)

新增模型, **字段形状与 cockpit `model.ts` 一一对应**, 保证复制过来的纯函数直接可用:

| Prisma 模型 | 对应 cockpit 类型 | 备注 |
|---|---|---|
| `CockpitContent` | `ContentItem` | 8 阶段 + A/B/C 档位 + topic 卡 + script 骨架 + 指标快照 + 复盘。**新增 FK:** `scriptDraftId` → ScriptDraft, `analysisId` → ContentAnalysis |
| `CockpitInspiration` | `InspirationCard` | 灵感池 |
| `StageEvent` | `StageEvent` | 档期核心: 某内容的某阶段排在某天 |
| `ReviewDay` / `LiveSession` | 同名 | 档期上的复盘日 / 直播 |
| `ScheduleObjectType` / `ScheduleObject` | 同名 | 自定义日程类型与实例 |
| `GoalCycle` | `GoalCycle` | 周期目标 (产出 / 涨粉 / 质量), 含历史归档 |
| `FollowerSnapshot` | `FollowerSnapshot` | 粉丝快照, 由爬虫自动生成 |
| `InsightRule` | `InsightRule` | 复盘沉淀的规则库 |
| `CockpitPrefs` | WorkspaceState 杂项 | 设计风格 / 侧栏顺序 / 页面标题 / 阶段颜色 / 创作者档案 (单行) |

### Workspace API

- `GET /api/v1/cockpit/workspace` — 读全部上述表, 组装成 `WorkspaceState` 返回。
- `PUT /api/v1/cockpit/workspace` — 接收整个 `WorkspaceState`, 服务端 diff 后拆解为各表 upsert/delete。
- 前端沿用 cockpit 原有「内存 state + 纯函数变换 + 防抖持久化」模式, 只把持久化目标从 IndexedDB 换成此 API。
- 并发: 单用户 last-write-wins; PUT 携带客户端加载时的 `updatedAt`, 服务端发现更新则返回冲突提示 (不做合并)。

## 3. 外壳与 IA

cockpit 侧栏接管全站, 最终导航:

```
灵感池 / 今日推进 / 档期规划 / Pipeline / 大目标 / 复盘实验室   ← cockpit 六视图 (支持拖拽排序)
──────
🪄 创作 /agent · 📊 数据 /dashboard · 👤 账号 /accounts · ⚙️ 设置 /settings   ← 现有页面挂入壳内
```

- 纸质编辑部风格 (暖纸底 `#f3f0e8` / 宋体标题 / clay·olive 点缀 / 暗色模式 / 5 套设计风格切换) 全站生效。
- 现有四个页面套进新壳后经 CSS 变量自动吃到主题; 页内细节样式渐进调整, 不在本期强求像素级统一。
- **删除**: 旧工作台看板 (`src/components/workbench/*`) 与内容库列表页 (`/content`) 被 Pipeline 视图取代。

## 4. 强能力集成点

1. **AI 写稿**: 内容抽屉脚本 tab 加「用 AI 写」入口 → 跳 `/agent` (带 topic 回填 + contentId); `/agent` 保存定稿时自动将关联 `CockpitContent` 的 `script` 阶段推进完成。
2. **爬虫指标回填**: auto-sync 匹配到已发视频后, 将播放/点赞/收藏/评论写入 `CockpitContent` 指标快照 (原版手动录入 → 我们自动)。
3. **粉丝快照**: 由爬虫 `AccountMetric` 每日自动生成 `FollowerSnapshot` → `calculateGoalHealth` 全自动。
4. **L1 预测对比**: 复盘实验室中, 内容若关联分析记录, 展示「预测区间 vs 实际播放」; 复盘结论写入 `InsightRule`。

## 5. 存量数据迁移 (一次性脚本)

| 现有数据 | 迁入 |
|---|---|
| TopicIdea (POOL) | `CockpitContent` stage=`topic` |
| ScriptDraft 草稿中 | stage=`script` (带 FK) |
| 定稿待拍 | stage=`recording` |
| 已拍待发 | stage=`publishing` |
| 已发布待复盘 | stage=`review` (发布时间与指标带入) |
| 已复盘 | stage=`archived` |
| 灵感 / discover 收藏 | `CockpitInspiration` |

- 脚本先 **dry-run** 打印映射清单, 用户确认后再写库。
- 旧表数据保留不删, 迁移可重复审计。

## 6. 实施顺序 (5 阶段, 每阶段独立验收)

1. **样式与外壳**: `globals.css` + 布局/侧栏/主题与风格切换移植, 现有页面挂入新壳 → 全站换脸。
2. **数据层**: Prisma 模型 + workspace API + 移植三个纯逻辑文件与测试。
3. **六视图移植**: 灵感池 → 今日/本周 → 档期 → Pipeline → 大目标 → 复盘实验室 + 内容抽屉, 接 API。
4. **迁移 + 集成**: 迁移脚本 (dry-run → 确认 → 写库); 四个集成点接通。
5. **收尾**: 删除旧 workbench/content 组件, 更新 README 与 docs。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| React 18 兼容 | 预期极少; 最小语法适配, 不改行为 |
| 双标签页互相覆盖 | 单用户接受 last-write-wins + `updatedAt` 冲突提示 |
| 迁移出错 | dry-run 确认 + 旧表保留 |
| 单文件拆分引入回归 | 拆文件不改逻辑; 搬运原项目测试 (`calculations` 等) 作回归底线 |

## 8. 明确不做 (YAGNI)

- 不搬 IndexedDB 存储层、JSON 备份导入导出 (数据库已覆盖)。
- 不搬 cockpit 的 AI analyze 路由与提示词降级 (我们的 AI 更强)。
- 不做多用户 / auth (沿用现状, `userId` 隔离留在 schema 层)。
- 不做旧看板与新 Pipeline 的并存过渡期。

## 9. 实际实施结论 (Task 14 回写, 与本 spec 的偏差)

14 个 Task 全部完成后, 与本 spec 的显式偏差记录如下 (均为"更简", 不影响功能覆盖):

1. **`FollowerSnapshot` 未建表** — §2 表格把它列为与 cockpit `FollowerSnapshot` 类型对应的 Prisma 模型, 实际未建。 `GET /api/v1/cockpit/workspace` 时直接从既有 `AccountMetric` (爬虫每日写入) 派生出 `FollowerSnapshot[]` 返回给前端, `PUT` 忽略该字段不写库。 §4.3 "由爬虫 `AccountMetric` 每日自动生成 `FollowerSnapshot`" 的准确含义是"读时派生", 不是"写时落表"——数据来源没变, 只是省掉一张纯衍生数据的表, 避免和 `AccountMetric` 双写不同步。
2. **备份/导入导出 UI 已裁** — §8 原计划就不搬 IndexedDB 存储层与 JSON 备份导入导出, 实施与计划一致: 数据库本身就是持久化底座, "设置" 里原本的导入导出 JSON 界面没有移植; 版本记录 (`VersionHistoryModal`) 里查看/导出历史版本的能力保留。
3. **`storage.ts` 只移植了 `migrateWorkspace` 纯函数** — §1 "只替换存储层" 的实际拆分: vendor 原 `app/lib/storage.ts` (537 行, IndexedDB 读写 + 老版本 workspace 升级) 里, 只有 `migrateWorkspace` (老 workspace 字段形状升级的纯函数) 被搬到 `src/lib/cockpit/migrations.ts`; IndexedDB 读写部分整体不搬, 替换成本项目自己写的 `src/lib/cockpit/storage.ts` (`loadWorkspace`/`saveWorkspace`, 走 `GET/PUT /api/v1/cockpit/workspace`, 带 `rev` 做 409 冲突检测)。
4. **`/content` 子路由保留** — §3 "删除: ... 内容库列表页 (`/content`) 被 Pipeline 视图取代" 准确范围是列表页 `src/app/content/page.tsx`; 三个子路由 `/content/preflight`(视频分析)、`/content/script`(脚本详情+分发登记)、`/content/retro-sync`(半自动复盘) 均保留, 未挂入侧栏导航, 但仍是 `/agent` 与既有创作闭环内部跳转的落点, 直接访问路径不变。
5. **补充: AI 体检/AI 质检按钮移除** (Task 14 code review 发现的收尾项, 非计划内偏差) — §8 已明确"不搬 cockpit 的 AI analyze 路由", 但视图层移植时 (Task 6/7) 遗留了两个调用 `/api/ai/analyze` 的按钮 (「AI 体检」「AI 质检」), 该路由确实没有移植, 点击会 fetch 404 后静默降级成一段"请手动分析"的提示词 —— 功能上不报错但名不副实。 Task 14 一并移除这两个按钮 (及其专用的 `analyze`/`aiLoading`/`AiModal`/`copyText` 状态与组件), 保留「用 AI 写脚本」跳 `/agent` 的入口 (这是本项目真实可用的 AI 写作能力)。
