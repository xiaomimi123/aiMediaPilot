# 文字叠加层 Remotion 回归 Implementation Plan（三十七期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真人口播链回归「关键词大字/注解/箭头」叠加层（AI 提取草案 + 剪辑台逐条改 + 画布拖拽定位）与常驻角标，渲染走 Remotion。

**Architecture:** 考古复活为主——提取 prompt 与格位/安全区思想从 `c48348b^` 搬回（工作区已导出考古文件），渲染层新写为 Remotion 组件。OverlayPlan 与 FilmPlan 平级存 `VideoProduction.overlayPlan`。定位唯一真源是纯函数 `overlayPosition`（拖拽坐标覆盖优先，否则格位），编辑层与渲染层共用它。模型碰不到坐标：提取响应 schema 不含 x/y。

**Tech Stack:** zod、Prisma(Json 列)、Remotion、DeepSeek(提取)、vitest 真渲染

**Spec:** `docs/superpowers/specs/2026-09-08-text-overlay-remotion-design.md`
**考古参照（任务书会引用，勿删）:** `.superpowers/sdd/2026-09-08-text-overlay/archaeology-prompt.ts`（127 行，旧提取 prompt）、`archaeology-overlay-plan.ts`（212 行，旧常量/slotPosition/textSafeZone）

## Global Constraints

- **模型不碰坐标（红线）**：提取 prompt 一字不提 x/y；`OverlayExtractionSchema`（LLM 响应用）**不含** x/y 且 `.strict()`；只有存储/PATCH 用的 `OverlayPlanSchema` 含可选 x/y。有测试钉死。
- **定位唯一真源**：`overlayPosition(aspect, personSide, item)` 纯函数；渲染层与拖拽编辑层都调它，绝不各写一份几何（本仓吃过"编辑台画布与渲染坐标是两套"的亏）。
- **动效一律走 `remotion/src/motion/anim.ts` 纯函数**（keyword 用 `smashIn`、note/arrow 用 `fadeUp`），不内联。
- **真渲染判据铁律**：同一时刻、内容一致、逐像素互比（`_ppm-test-utils`），跨时刻比墨量已被证伪禁止使用；每个渲染类任务做变异验证并报告前后数值。
- **改 Prisma schema 后**：`npx prisma db push && npx prisma generate`，然后 `pkill -f 'next dev'; pkill -f 'tsx src/jobs/workers'; sleep 2; nohup npm run dev:all > /tmp/mediapilot-dev.log 2>&1 &`，curl 200 才算完成。
- 不跑 `npm run build`（控制者跑）；dev server 不许杀了不起；临时文件放 /tmp；`git add` 逐个点名；提交信息结尾：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/lib/video-production/overlay-plan.ts`（新建） | 常量、两个 zod schema（提取版无 x/y / 存储版有）、`overlaySlotRect`+`overlayPosition` 纯函数（**归一化 0~1 坐标**） |
| `src/lib/llm/prompts/overlay-plan.ts`（新建=考古复活） | 提取 prompt（system+user+响应 schema 引用提取版） |
| `prisma/schema.prisma`（修改） | `VideoProduction.overlayPlan Json?`、`VideoTemplate.cornerBadge String?` |
| `src/jobs/workers/video-production-worker.ts`（修改） | talking-head 链转写后提取落库；渲染注入 overlays/personSide/cornerBadge |
| `remotion/src/overlay/TextOverlayLayer.tsx`（新建） | 三种元素渲染 + 角标；消费 `overlayPosition` |
| `remotion/src/Film.tsx` + `remotion-render.ts`（修改） | `FilmInput` 加 `overlays?/overlayPersonSide?/cornerBadge?`（同形不 import）；挂层（人物上、字幕下） |
| `src/app/api/v1/cockpit/video-productions/[id]/overlay-plan/route.ts`（新建） | PATCH 全量替换（存储版 schema 校验） |
| `src/components/templates/template-editor.tsx` + `scripts/generate-template-demos.ts`（修改） | 参数搬回主区 + cornerBadge 输入 + 指纹三字段 + 演示带示例 overlays |
| `src/components/films/overlay-editor.tsx`（新建） | 剪辑台「文字叠加」区：逐条编辑 + 拖拽层 |
| `src/components/films/film-plan-workbench.tsx` + `plan-preview.tsx`（修改) | 挂编辑区；Player 传 overlays |

---

### Task 1: 契约与定位纯函数

**Files:**
- Create: `src/lib/video-production/overlay-plan.ts`
- Test: `tests/lib/video-production/overlay-plan.test.ts`（新建）

**Interfaces (Produces，后续任务全按这套名字):**
```ts
export const OVERLAY_SLOTS = ['left-1','left-2','left-3','left-4','left-5','top-center','bottom-center'] as const;
export const OVERLAY_KINDS = ['keyword','note','arrow'] as const;
export type OverlayItem = { kind, text, slot, startMs, endMs, x?: number, y?: number };
export const OverlayExtractionSchema; // LLM 响应: items 数组, 元素 .strict() **无 x/y**
export const OverlayPlanSchema;       // 存储/PATCH: 同上 + x/y 可选(0~1)
export function overlaySlotRect(aspect: '16:9'|'9:16', personSide: 'left'|'center'|'right', slot): { x: number; y: number; anchor: 'top'|'bottom' };
export function overlayPosition(aspect, personSide, item): { x; y; anchor };  // item.x/y 存在→直接用(anchor 'top')
```
坐标全部 **0~1 归一化**（考古版是像素+ASS 锚点，移植时换算；勿照抄像素）。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import {
  OverlayExtractionSchema, OverlayPlanSchema, overlaySlotRect, overlayPosition,
} from '@/lib/video-production/overlay-plan';

const item = (over = {}) => ({ kind: 'keyword', text: '任何平台', slot: 'left-1', startMs: 0, endMs: 3000, ...over });

describe('两个 schema 的分工', () => {
  it('提取版: 合法条目通过; text 超 14 字拒; 未知 slot 拒; 多余键拒(.strict)', () => {
    expect(OverlayExtractionSchema.safeParse({ items: [item()] }).success).toBe(true);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ text: '这句话实在太长超过十四个字了吧' })] }).success).toBe(false);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ slot: 'right-1' })] }).success).toBe(false);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ color: 'red' })] }).success).toBe(false);
  });

  it('红线: 提取版拒收 x/y —— 模型不碰坐标', () => {
    expect(OverlayExtractionSchema.safeParse({ items: [item({ x: 0.5, y: 0.5 })] }).success).toBe(false);
  });

  it('存储版收 x/y(0~1), 越界拒', () => {
    expect(OverlayPlanSchema.safeParse({ items: [item({ x: 0.5, y: 0.5 })] }).success).toBe(true);
    expect(OverlayPlanSchema.safeParse({ items: [item({ x: 1.5 })] }).success).toBe(false);
  });
});

describe('定位纯函数', () => {
  it('人在右 → left 格在左半边; 人在左 → 格挪到右半边', () => {
    expect(overlaySlotRect('16:9', 'right', 'left-1').x).toBeLessThan(0.5);
    expect(overlaySlotRect('16:9', 'left', 'left-1').x).toBeGreaterThan(0.5);
  });
  it('五格自上而下递增', () => {
    const ys = [1,2,3,4,5].map((i) => overlaySlotRect('16:9', 'right', `left-${i}` as never).y);
    for (let i = 1; i < 5; i++) expect(ys[i]).toBeGreaterThan(ys[i-1]);
  });
  it('竖屏: 格子整体在上半(人脸占中下)', () => {
    expect(overlaySlotRect('9:16', 'center', 'left-5').y).toBeLessThan(0.5);
  });
  it('bottom-center 抬到字幕安全区上方(y < 0.82)', () => {
    expect(overlaySlotRect('16:9', 'right', 'bottom-center').y).toBeLessThan(0.82);
  });
  it('overlayPosition: 有 x/y 用 x/y, 无则回格位', () => {
    expect(overlayPosition('16:9', 'right', item({ x: 0.8, y: 0.6 }))).toMatchObject({ x: 0.8, y: 0.6 });
    expect(overlayPosition('16:9', 'right', item())).toEqual(overlaySlotRect('16:9', 'right', 'left-1'));
  });
});
```

- [ ] **Step 2: 跑确认失败**（模块不存在）
- [ ] **Step 3: 实现**——常量/kind/slot 从考古文件搬（`archaeology-overlay-plan.ts` 顶部）；schema 新写（两版共享一个 base 对象，提取版 `.strict()` 原样、存储版 `.extend({x,y}).strict()`）；`overlaySlotRect` 移植 `slotPosition`+`textSafeZone` 思想到归一化坐标（横屏：人右→格带 x∈[0.06,0.42] 五行 y 0.18→0.72；人左→镜像；竖屏：格带在 y∈[0.08,0.42]；bottom-center y=0.78 避字幕）。每个数值写注释讲来源（参考片/考古版）。
- [ ] **Step 4: 跑通 + typecheck**
- [ ] **Step 5: 提交** `feat(video): 叠加层契约与定位纯函数 —— 模型不碰坐标的红线在 schema 上`

---

### Task 2: 数据列 + 提取复活（worker）

**Files:**
- Modify: `prisma/schema.prisma`（`VideoProduction` 加 `overlayPlan Json?`；`VideoTemplate` 加 `cornerBadge String?`）
- Create: `src/lib/llm/prompts/overlay-plan.ts`（考古复活）
- Modify: `src/jobs/workers/video-production-worker.ts`
- Test: `tests/lib/video-production/overlay-extraction.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `OverlayExtractionSchema`
- Produces: `buildOverlayExtraction(): { buildSystemPrompt(): string; buildUserMessage(input: { segments: {startMs;endMs;text}[]; durationMs: number }): ContentPart[] }`；worker 在 talking-head 链落库 `vp.overlayPlan`

- [ ] **Step 1: schema 两列 + db push + generate + 重启 dev:all + curl 200**（Global Constraints 命令）
- [ ] **Step 2: 写失败的测试**——① prompt 文本包含五条硬规则的关键句（「绝不把字幕原句抄成关键词」「一屏同时最多 3 个元素」）且**全文不出现 x/y/坐标字样**（红线）；② 模拟 LLM 返回：合法 → 解析出 items；text 超长 → 修复循环收到的 issue 里含该路径；两轮仍败 → 返回 `{ items: [] }` 且 notice 非空（提取失败不拦片）。提取执行器写成独立可测函数 `extractOverlayPlan({ llm, segments, durationMs }): Promise<{ plan; notice: string | null }>`，mock llm 测。
- [ ] **Step 3: 实现**——prompt 从 `archaeology-prompt.ts` 复活（system 原样；响应 schema 换成 Task 1 提取版；修复循环措辞照 `formatIssuesForModel` 的纪律：单条问题+该怎么改）。worker：talking-head 链 `mode==='preview' && !skipPlanGeneration` 分支里、分镜生成同阶段（rawTranscript 可用处，约 738 行后），`template.textOverlayEnabled` 时调 `extractOverlayPlan`，结果写 `overlayPlan`，notice 并进 productionNotice。
- [ ] **Step 4: 跑通 + typecheck:all**
- [ ] **Step 5: 提交** `feat(video): 叠加提取从旧链考古复活 —— 失败落空计划不拦片`

---

### Task 3: Remotion 渲染层 + 注入

**Files:**
- Create: `remotion/src/overlay/TextOverlayLayer.tsx`
- Modify: `remotion/src/Film.tsx`、`src/lib/video-production/remotion-render.ts`（FilmInput 同形三字段）、worker 渲染注入两处 + still/体检两处、`shot-still` 路由、film-plan GET（顶层加 `overlayPlan`/`overlayPersonSide`，供 Task 5/6）
- Test: `tests/lib/video-production/overlay-render.test.ts`（新建，真渲染）

**Interfaces:**
- Consumes: Task 1 `overlayPosition`/`OverlayItem`；Task 2 的库列
- Produces: `FilmInput.overlays?: OverlayItem[]`、`overlayPersonSide?: 'left'|'center'|'right'`、`cornerBadge?: string | null`

- [ ] **Step 1: 写失败的真渲染测试**（renderCard 辅助照 `cards-ring-odometer-entity.test.ts` 抄，input 带 overlays）：
  - A(无 overlays) vs B(一条 keyword left-1) 同帧差分 > 50；
  - B vs C(同条但 x:0.8,y:0.6 拖到右下) 差分 > 50（坐标覆盖真的动了位置）；
  - D(cornerBadge 三行) vs A 右上角区差分 > 50；
  - 变异：`TextOverlayLayer` 返回 null → 全部归零转红（报告写数值）。
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现**——`TextOverlayLayer`：`overlays.map` 每条按 `startMs/endMs` 套 `Sequence`，位置 `overlayPosition`（乘画布宽高），keyword 蓝大字（`theme.accents.blue` + 白描边 + `smashIn`）、note 白中字 `fadeUp`、arrow `↓` `fadeUp`；`data-overlay-idx={i}` 打在每条容器上（Task 6 拖拽层找元素用）。cornerBadge 右上小字白色带阴影 whiteSpace:pre-line 恒显。`Film.tsx` 挂在人物层之上、`<Captions>` 之下。注入点表达式照三十六期 templateStyle 惯例。
- [ ] **Step 4: 跑通 + 变异 + 全量 vitest + typecheck:all**
- [ ] **Step 5: 提交** `feat(video): TextOverlayLayer —— 关键词大字/注解/箭头/角标进 Remotion`

---

### Task 4: 模板编辑器 + 演示

**Files:**
- Modify: `src/components/templates/template-editor.tsx`、`scripts/generate-template-demos.ts`
- Test: `tests/components/template-default-style.test.tsx`（追加指纹用例）

- [ ] **Step 1: 失败测试**——指纹：`cornerBadge`/`textOverlayEnabled`/`personSide` 任一变 → hash 变；全同 → 不变。
- [ ] **Step 2: 实现**——`textOverlayEnabled` + `personSide` 两个 Row 从「旧版遗留」details 区**剪回**「真人形象与文字叠加」节（hint 重写：「开 = 出片时 AI 从口播提关键词大字，剪辑台可逐条改/拖」；personSide hint 保留原文）。新增 `cornerBadge` textarea Row（VideoTemplateConfig+zod+GET/PUT/duplicate 同步，模式照 defaultShotStyle；duplicate 对账测试会自动盯上新列——红了就补）。指纹三字段（key 排序归一惯例）。演示脚本：出镜模板 input 加固定示例 `overlays`（两条 keyword+一条 arrow）与 `cornerBadge: '模板演示'`，让演示视频展示这层。
- [ ] **Step 3: 跑通 + `FORCE=1 npm run gen:template-demos` 确认 5/5**
- [ ] **Step 4: 提交** `feat(templates): 文字叠加参数从遗留区复活 + 角标配置 + 演示带叠加层`

---

### Task 5: 剪辑台编辑区 + PATCH

**Files:**
- Create: `src/app/api/v1/cockpit/video-productions/[id]/overlay-plan/route.ts`、`src/components/films/overlay-editor.tsx`
- Modify: `src/components/films/film-plan-workbench.tsx`、`src/components/films/plan-preview.tsx`（props 加 overlays 透传）
- Test: `tests/api/overlay-plan-patch.test.ts` + `tests/components/overlay-editor.test.tsx`（新建）

- [ ] **Step 1: 失败测试**——PATCH：合法全量替换落库(`OverlayPlanSchema`)、非法 400 不写、归属他人 404；编辑区组件（props 进出）：渲染 N 条、改 text 回调、删一条、加一条默认 keyword、「恢复格位」对带 x/y 的条目出现且回调删 x/y。
- [ ] **Step 2: 实现**——PATCH 机制照 film-plan PATCH（含 rev/事务惯例看该文件现状）。`overlay-editor.tsx`：逐条行（kind 徽章下拉 + text 输入 + slot 下拉 + 起止秒 + 删）+「加一条」+ 顶部说明；workbench 在 plan_ready 且 mode=talking-head 时挂在分镜条下方，state 从 film-plan GET 顶层 `overlayPlan` 来，保存与「保存修改」同批（或独立保存钮，看 workbench 现有保存结构取一致做法）；`plan-preview` inputProps 加 `overlays`/`overlayPersonSide`——**编辑立即反映在 Player**。
- [ ] **Step 3: 跑通 + typecheck + tests/components 全绿**
- [ ] **Step 4: 提交** `feat(films): 剪辑台文字叠加编辑区 —— AI 草案逐条可改, 预览即时`

---

### Task 6: 画布拖拽

**Files:**
- Modify: `src/components/films/overlay-editor.tsx`（或新建 `overlay-drag-layer.tsx`）、`plan-preview.tsx`（编辑模式下叠 DOM 层）
- Test: `tests/components/overlay-drag.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 1 `overlayPosition`（**编辑层定位必须调它**，不许自算）；Task 3 的 `data-overlay-idx`
- Produces: 拖拽把手层，拖完回调 `onPositionChange(idx, { x, y })`（归一化）

- [ ] **Step 1: 失败测试**——① 把手层给每条 overlay 渲一个把手，其 left/top 百分比 === `overlayPosition` 的返回（**几何一致性测试**：变异 overlayPosition 的一个格位值，把手位置断言必须跟着变——钉住"共用同一函数"）；② pointerdown→move→up 后回调收到归一化 x/y（0~1 内 clamp）；③ 有 x/y 的条目把手在 x/y 处。
- [ ] **Step 2: 实现**——预览容器 `position:relative`，把手层 absolute 覆盖 Player；每条 overlay 渲染半透明把手（kind 色点+text 缩略），位置 `overlayPosition(...)` 百分比；pointer 事件算容器内相对坐标 → clamp(0,1) → 回调 → workbench setState → Player inputProps 即时更新（拖拽中节流 ~60ms）。「恢复格位」在 Task 5 已有。触屏 pointerEvents 统一用 Pointer Events。
- [ ] **Step 3: 真机验收**（控制者辅助）：拖一条 keyword 到另一侧 → Player 即时跟动 → 保存 → 刷新后位置保持 → 渲染帧与把手位置一致。
- [ ] **Step 4: 跑通 + 全量 + 提交** `feat(films): 叠加元素画布拖拽 —— 编辑层与渲染层共用同一个定位函数`

---

## Self-Review

**1. Spec 覆盖**：§3.1→T1+T2 列；§3.2→T2；§3.3→T3；§3.4→T3 注入+T4；§3.5→T5+T6；§四测试 1~7→T1(1,2,7)/T3(3,4,6 渲染半)/T5(5)/T6(6 编辑半)；§六风险→bottom-center 抬高(T1 测试第 4 条)、提取失败不拦片(T2)、schema 重启(T2 Step 1)。
**2. 占位**：T2 prompt「原样复活」指向工作区考古文件（127 行实文本，非占位）；T5 PATCH「机制照 film-plan PATCH」为既有真源引用。
**3. 类型一致**：`OverlayItem`/`overlayPosition`/`data-overlay-idx`/`onPositionChange` 各任务同名；FilmInput 三字段 T3 产 T4/T5/T6 消费。
**4. 风险**：几何一致性靠 T6 测试① 的变异断言钉；x/y 红线 T1+T2 双测；worker 提取插入点(约 738 行)由实施者核实 rawTranscript 就绪处。
