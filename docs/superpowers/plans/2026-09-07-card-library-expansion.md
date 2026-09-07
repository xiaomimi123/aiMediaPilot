# 卡片库扩容 Implementation Plan（三十三期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卡片库从 4 张扩到 9 张——新增圆环比例、翻牌计数、增长曲线、排名条、人物名牌，让数字的四种语义（绝对量/比例/趋势/排名）各有各的呈现。

**Architecture:** 每张新卡 = Remotion 组件（flex 布局、动效走 `anim.ts` 纯函数、文字块打 `data-slot` 标记）+ zod 槽位 schema + 卡片说明（带可判定的「什么时候用」界线）+ 真渲染测试。五张卡按复杂度从低到高分四个任务，最后一个任务做选卡分布实测。

**Tech Stack:** Remotion 4.0.399（`interpolate`/`useCurrentFrame`/SVG）、zod、vitest 真渲染

**Spec:** `docs/superpowers/specs/2026-09-07-card-library-expansion-design.md`

## Global Constraints

- **填槽契约不变**：模型只选卡 + 填字，不碰坐标/颜色/动效参数。新卡的 slots 里**不许出现**任何视觉参数（颜色、位置、字号、时长）。
- **`.strict()` 全层生效**：结构化数组（`points`/`rows`/`chips`）的每个元素也要 `.strict()`，多一个字段就解析失败。
- **错误信息必须精准**：schema 用 `discriminatedUnion`（既有），新卡不许引入 `z.union` —— 二十七期实测过，`invalid_union` 的并列报错会让模型**放弃整张卡**（`stat` 存活率 0/3）。
- **动效走 `anim.ts` 纯函数**，不在卡片里内联写动画逻辑（spec §四：为下一期「换动效」留位）。需要新手法时**在 `anim.ts` 里加纯函数**，不在组件里写。
- **文字块打 `data-slot` 标记**（spec §四：为下一期「拖动」留位）。
- **卡片不许用绝对坐标**：既有 `card-registry.test.ts` 有断言钉着，新卡同样受约束。SVG 内部的坐标不算（那是图形的内部几何），但 SVG 容器本身要靠 flex 定位。
- **不碰 `motion/components.tsx`**（video-talkcraft 授权搬运物，保持原样）。
- **`remotion/` 独立 tsconfig**，验证一律 `npm run typecheck:all`；`npm run build` 在动了组件后要跑（**跑 build 前确认没有 `next dev` 在跑**，否则撞 `MODULE_NOT_FOUND`，本项目已知坑）。
- 注释、文档、提交信息用中文，说清「为什么」。提交信息结尾带：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## 砍尾巴预案（spec §七）

五张卡一期可能偏重。若执行中发现单期过重：**从 `entity` 开始砍**（最简单、独立性最强），`curve` 优先保（最复杂但价值最高）。**砍的决定必须记进 ledger 并报告，不许默默少做。**

## File Structure

| 文件 | 职责 |
| --- | --- |
| `remotion/src/cards/Ring.tsx` / `Odometer.tsx` / `Curve.tsx` / `Rank.tsx` / `Entity.tsx`（新建×5） | 五张新卡组件 |
| `remotion/src/cards/index.ts`（修改） | `CARDS` 注册表加五项 |
| `remotion/src/motion/anim.ts`（修改） | 新增新卡需要的动效纯函数（`ringDraw`/`digitRoll`/`curveDraw`/`barGrow`） |
| `src/lib/video-production/shot-plan.ts`（修改） | `CARD_TYPES` 加五项、`SLOTS` 加五份 schema、`describeCardsForPrompt()` 加五段说明 |
| `src/lib/video-production/remotion-render.ts`（修改） | `findBlankSlots` 的 switch 加五个 case |
| `tests/lib/video-production/cards-*.test.ts`（新建） | 每张卡的真渲染测试 |

---

### Task 1: 动效纯函数（五张卡共用的新手法）

**Files:**
- Modify: `remotion/src/motion/anim.ts`
- Test: `tests/lib/video-production/anim.test.ts`（扩展既有文件）

**Interfaces:**
- Consumes: 既有的 `prog(frame, fps, atSec, durSec)` 内部辅助（同文件内，不导出）
- Produces（签名与既有七个函数同形）：
  - `ringDraw(frame, fps, atSec, ratio, circumference)` → `{strokeDasharray, strokeDashoffset}` —— 环从 12 点起画到 `ratio` 比例，0.9s
  - `curveDraw(frame, fps, atSec, durSec)` → `number` —— 归一化描画进度 0→1（配合 SVG `pathLength=1` 用），时长由调用方给（曲线卡的 `drawSec`）
  - `barGrow(frame, fps, atSec, ratio)` → `{transform, transformOrigin}` —— `scaleX` 从 0 长到 `ratio`，0.9s
  - `countTo(frame, fps, atSec, target, durSec)` → `number` —— 从 0 数到 target（既有卡片里各自手写的滚动逻辑统一到这里）

- [ ] **Step 1: 写失败的测试**

```ts
// 追加到 tests/lib/video-production/anim.test.ts 末尾
import { ringDraw, curveDraw, barGrow, countTo } from '../../../remotion/src/motion/anim';

describe('新卡用的动效函数(三十三期)', () => {
  const FPS = 30;
  const C = 880; // 圆周长, 2πR ≈ 2π×140

  it('ringDraw: at 之前环全空, 结束后停在 ratio 对应的位置', () => {
    expect(ringDraw(0, FPS, 1, 0.5, C).strokeDashoffset).toBe(C);
    const done = ringDraw(FPS * 3, FPS, 1, 0.5, C);
    expect(done.strokeDasharray).toBe(C);
    expect(done.strokeDashoffset).toBeCloseTo(C * 0.5, 1);
  });

  it('ringDraw: ratio=1 时结束后 offset 归零(整圈画满)', () => {
    expect(ringDraw(FPS * 3, FPS, 0, 1, C).strokeDashoffset).toBeCloseTo(0, 1);
  });

  it('curveDraw: 0 → 1, 时长由调用方给', () => {
    expect(curveDraw(0, FPS, 1, 2)).toBe(0);
    expect(curveDraw(FPS * 5, FPS, 1, 2)).toBe(1);
    // 时长 2s: at=1s 起, 2s 处正好走一半
    expect(curveDraw(FPS * 2, FPS, 1, 2)).toBeCloseTo(0.5, 1);
  });

  it('barGrow: scaleX 从 0 长到 ratio, 左对齐原点', () => {
    expect(barGrow(0, FPS, 0, 0.8).transform).toBe('scaleX(0)');
    expect(barGrow(FPS * 3, FPS, 0, 0.8).transform).toBe('scaleX(0.8)');
    expect(barGrow(0, FPS, 0, 0.8).transformOrigin).toBe('left center');
  });

  it('countTo: 从 0 数到 target, 结束后精确等于 target', () => {
    expect(countTo(0, FPS, 1, 900, 1.6)).toBe(0);
    expect(countTo(FPS * 5, FPS, 1, 900, 1.6)).toBe(900);
    const mid = countTo(FPS * 1 + 24, FPS, 1, 900, 1.6);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(900);
  });

  it('countTo: 非整数 target 结束后不被取整(与 Stat 卡的既有约定一致)', () => {
    expect(countTo(FPS * 5, FPS, 0, 32.2, 1)).toBeCloseTo(32.2, 5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/anim.test.ts`
Expected: FAIL —— 四个函数都不存在

- [ ] **Step 3: 实现**

```ts
// 追加到 remotion/src/motion/anim.ts 末尾

/**
 * 环形进度描画(三十三期)。
 *
 * 手法: SVG `stroke-dasharray` = 周长、`stroke-dashoffset` 从周长收到
 * `周长×(1-ratio)` —— 未开始时整圈都是"空隙"(看不见), 画完时露出 ratio 那一段。
 * 与 overlay-studio 的 RingMetric 同一手法, 但它靠 CSS transition 走 1100ms、
 * 环心数字另用 JS 计时器走 1100ms(两套时钟手动对齐); 我们两者都由 frame 驱动,
 * 天然同步, 不需要对齐。
 */
export const ringDraw = (
  frame: number, fps: number, atSec: number, ratio: number, circumference: number,
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.9);
  const e = Easing.out(Easing.cubic)(p);
  return {
    strokeDasharray: circumference,
    strokeDashoffset: circumference * (1 - ratio * e),
  };
};

/**
 * 曲线描画的归一化进度(三十三期)。
 *
 * 返回 0→1 的裸进度而不是样式对象 —— 曲线卡要用同一个进度值同时驱动三件事
 * (描画长度、面积透明度、数据点逐个亮起), 返回样式就没法复用。配合 SVG 的
 * `pathLength={1}` 使用: 把路径长度归一化成 1 之后, "画了多长"直接就是这个进度值,
 * 与真实像素长度解耦(overlay-studio 的 GrowthCurve 用的就是这个技巧)。
 */
export const curveDraw = (frame: number, fps: number, atSec: number, durSec: number): number =>
  Easing.out(Easing.cubic)(prog(frame, fps, atSec, durSec));

/** 条形从左生长到 ratio(三十三期)。`transformOrigin: left` 让它从左端长出而不是中间撑开。 */
export const barGrow = (
  frame: number, fps: number, atSec: number, ratio: number,
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.9);
  const e = Easing.out(Easing.cubic)(p);
  return {transform: `scaleX(${clean(ratio * e, 3)})`, transformOrigin: 'left center'};
};

/**
 * 从 0 数到 target(三十三期)。
 *
 * 结束后**精确等于** target, 不做取整 —— 非整数值(如 facts 台账里的 32.2%)
 * 取整会与台账不再逐位一致, 这是 Stat 卡二十九期定下的约定(见 lib.tsx 的
 * roundToSourceDecimals)。显示时的取整精度由调用方按 target 自身的小数位决定。
 */
export const countTo = (
  frame: number, fps: number, atSec: number, target: number, durSec: number,
): number => {
  const p = prog(frame, fps, atSec, durSec);
  const e = Easing.out(Easing.cubic)(p);
  return target * e;
};
```

> `barGrow` 的 `clean(ratio * e, 3)` 在 e=1 时要输出 `scaleX(0.8)` 而不是 `scaleX(0.800)`——`clean` 是同文件已有的辅助（三十二期加的），直接用。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/anim.test.ts`
Expected: 既有 8 条 + 新增 6 条全 PASS

- [ ] **Step 5: 提交**

```bash
git add remotion/src/motion/anim.ts tests/lib/video-production/anim.test.ts
git commit -m "feat(video): 新卡用的四个动效纯函数"
```

---

### Task 2: 契约层——五张卡的 schema 与卡片说明

**Files:**
- Modify: `src/lib/video-production/shot-plan.ts`
- Modify: `src/lib/video-production/remotion-render.ts`（`findBlankSlots` 加 case）
- Test: `tests/lib/video-production/new-cards-schema.test.ts`

**Interfaces:**
- Produces：`CARD_TYPES` 扩为 9 项；`SLOTS` 新增五份；`describeCardsForPrompt()` 覆盖九张卡

**五份 schema（逐字照用）：**

```ts
  ring: z.object({
    label: z.string().min(1).max(16),
    value: z.number(),
    max: z.number().positive().default(100),
    unit: z.string().max(6).optional(),
    note: z.string().max(24).optional(),
  }).strict(),

  odometer: z.object({
    label: z.string().min(1).max(16),
    value: z.number().int(),
    unit: z.string().max(6).optional(),
    note: z.string().max(24).optional(),
  }).strict(),

  curve: z.object({
    label: z.string().min(1).max(16),
    points: z.array(z.object({
      at: z.string().min(1).max(8),
      value: z.number(),
    }).strict()).min(3).max(8),
    unit: z.string().max(6).optional(),
    note: z.string().max(24).optional(),
  }).strict(),

  rank: z.object({
    title: z.string().min(1).max(16),
    rows: z.array(z.object({
      name: z.string().min(1).max(12),
      value: z.number(),
    }).strict()).min(2).max(6),
    suffix: z.string().max(6).optional(),
  }).strict(),

  entity: z.object({
    chips: z.array(z.object({
      name: z.string().min(1).max(12),
      sub: z.string().max(16).optional(),
      tone: z.enum(['light', 'dark']),
    }).strict()).min(1).max(3),
    note: z.string().max(20).optional(),
  }).strict(),
```

**五段卡片说明（逐字照用，追加到 `describeCardsForPrompt()` 的 list 那行之后）：**

```ts
    '- `ring`：一个比例做成圆环，环心是数字。**什么时候用**：这个数**有分母**——占比、完成度、达成率、市场份额。槽位：label、value、max（分母，默认 100）、unit（可选）、note（可选注脚）。**没有分母的数用 `stat`**，别把绝对量硬塞成比例。',
    '- `odometer`：翻牌计数器，每位数字像里程表一样滚到位。**什么时候用**：这个数的**量级本身**是重点（累计总量、里程碑、突破多少）。槽位：label、value（**必须是整数**）、unit（可选）、note（可选）。带小数的用 `stat`，有分母的用 `ring`。',
    '- `curve`：一条随时间变化的曲线，点会跟着画到的位置逐个亮起。**什么时候用**：讲的是**一段过程**——增长、下滑、波动。槽位：label、points（3~8 个点，每点 at 是时间标签≤8 字、value 是数值）、unit（可选）、note（可选出处）。**只有首尾两个数、不讲中间过程的用 `contrast`**。',
    '- `rank`：多项排名，每项一条能比长短的横条。**什么时候用**：几项之间要**比大小**（排名、份额、多方对比）。槽位：title、rows（2~6 项，每项 name≤12 字 + value 数值）、suffix（可选单位）。**只是列举、不比大小的用 `list`**。',
    '- `entity`：人物/机构名牌，滑入后常驻。**什么时候用**：要**点名具体的人或机构**（引用来源、提到某公司某人）。槽位：chips（1~3 块，每块 name≤12 字、sub 可选≤16 字放头衔或机构、tone 选 light 或 dark）、note（可选≤20 字）。泛指的主体（"有些人"、"很多公司"）不要用这张。',
```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, CARD_TYPES, describeCardsForPrompt } from '@/lib/video-production/shot-plan';

const base = { shotId: 's1', startMs: 0, endMs: 4000 };

describe('五张新卡的 schema', () => {
  it('CARD_TYPES 扩到 9 张', () => {
    expect(CARD_TYPES).toEqual([
      'statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity',
    ]);
  });

  it('ring: 合法通过; max 缺省为 100', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '四线城市占比', value: 32.2, unit: '%' } });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { slots: { max: number } }).slots.max).toBe(100);
  });

  it('odometer: value 必须是整数', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 11000 } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'odometer', slots: { label: '累计', value: 32.2 } }).success).toBe(false);
  });

  it('curve: points 少于 3 个被拒, 多于 8 个被拒', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ at: `第${i}月`, value: i * 10 }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(2) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(3) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'curve', slots: { label: '增长', points: pts(9) } }).success).toBe(false);
  });

  it('curve: 数组元素也是 strict —— 点里多一个字段就失败', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'curve',
      slots: { label: '增长', points: [{ at: '1月', value: 1, color: 'red' }, { at: '2月', value: 2 }, { at: '3月', value: 3 }] },
    });
    expect(r.success).toBe(false);
  });

  it('rank: rows 2~6 项', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `第${i}名`, value: 100 - i }));
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(1) } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(2) } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'rank', slots: { title: '排名', rows: rows(7) } }).success).toBe(false);
  });

  it('entity: chips 1~3 块, tone 只认 light/dark', () => {
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'DeepSeek', tone: 'dark' }] } }).success).toBe(true);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [{ name: 'X', tone: 'blue' }] } }).success).toBe(false);
    expect(ShotPlanSchema.safeParse({ ...base, card: 'entity', slots: { chips: [] } }).success).toBe(false);
  });

  it('报错仍然精准 —— 单一分支的问题, 不是四个分支的并列噪音', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'ring', slots: { label: '占比', value: '32.2' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0].path).toEqual(['slots', 'value']);
    }
  });
});

describe('九张卡的说明', () => {
  const text = describeCardsForPrompt();

  it('每张卡都有一段说明', () => {
    for (const t of ['statement', 'stat', 'contrast', 'list', 'ring', 'odometer', 'curve', 'rank', 'entity']) {
      expect(text, `${t} 缺说明`).toContain(`\`${t}\``);
    }
  });

  it('容易混的四对都写了可判定的界线', () => {
    expect(text).toContain('有分母');      // ring vs stat
    expect(text).toContain('必须是整数');  // odometer vs stat
    expect(text).toContain('不讲中间过程'); // curve vs contrast
    expect(text).toContain('不比大小');    // rank vs list
  });

  it('说明里不提 style/坐标/颜色 —— 那些不归模型管', () => {
    expect(text).not.toMatch(/style|accent|坐标|字号/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/new-cards-schema.test.ts`
Expected: FAIL —— `CARD_TYPES` 还是 4 项

- [ ] **Step 3: 实现**

`shot-plan.ts`：`CARD_TYPES` 改为九项（顺序与测试一致）；`SLOTS` 加上面五份；`SHOT_VARIANTS` 的手写元组加五项（**注意**：那里有一段模块加载期断言防止漏加，漏了会在启动时抛错）；`describeCardsForPrompt()` 加五段说明。

`remotion-render.ts` 的 `findBlankSlots` switch 加五个 case：
```ts
      case 'ring':
      case 'odometer':
        if (isBlank(slots.label)) bad('label');
        break;
      case 'curve':
        if (isBlank(slots.label)) bad('label');
        break;
      case 'rank':
        if (isBlank(slots.title)) bad('title');
        break;
      case 'entity': {
        const chips = Array.isArray(slots.chips) ? slots.chips : [];
        chips.forEach((c, i) => {
          if (isBlank((c as { name?: unknown })?.name)) bad(`chips[${i}].name`);
        });
        break;
      }
```

- [ ] **Step 4: 跑测试确认通过 + 无回归**

Run: `npx vitest run tests/lib/video-production/ && npm run typecheck:all`
Expected: 新测试全过；既有测试无回归（**注意** `card-registry.test.ts` 会因为「九种卡都要有实现」而失败——Task 3/4 才建组件。**这是预期的**：在 Task 3 完成前，先在 `index.ts` 里把五张新卡**临时指向 `Statement`** 让注册表测试通过，并在该行加注释 `// TODO(三十三期 Task 3/4): 换成真实组件`。Task 3/4 会逐个替换。）

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/ remotion/src/cards/index.ts tests/
git commit -m "feat(video): 五张新卡的槽位契约与卡片说明"
```

---

### Task 3: 三张简单卡（ring / odometer / entity）

**Files:**
- Create: `remotion/src/cards/Ring.tsx` / `Odometer.tsx` / `Entity.tsx`
- Modify: `remotion/src/cards/index.ts`（换掉 Task 2 的临时指向）
- Test: `tests/lib/video-production/cards-ring-odometer-entity.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ringDraw`/`countTo`、既有的 `fadeUp`/`slideIn`/`staggerIn`；`speedT`/`resolveAccent`/`scaleStyle`（`cards/style.ts`）；`safeBox`/`scaleFont`（`layout/grid.ts`）
- Produces: 三个组件，签名与既有卡一致 `{slots, durationInFrames, theme, style?}`

**三张卡的构成（spec §2.1/2.2/2.5）：**

- **Ring**：纵向居中 flex —— label（小字，`data-slot="label"`）→ SVG 圆环容器（viewBox 320×320，`r=140`，两条 circle：轨道 + 进度环，整体 `rotate(-90deg)` 让起点在 12 点）+ 环心绝对居中的数字与单位（`data-slot="value"`）→ note（`data-slot="note"`）。环用 `ringDraw(frame, fps, t(0.3), value/max, 2*Math.PI*140)`，数字用 `countTo(frame, fps, t(0.3), value, 0.9)` —— **两者同一起点同一时长**，天然同步。
- **Odometer**：纵向居中 —— label → 逐位数字滚轮 + unit → note。每位一个 `overflow:hidden` 的窗口（高 1.15em），内部纵列 0-9 每格 1.15em，`translateY(-digit × 1.15em)`。**逐位错峰**：第 i 位（从个位数起）延迟 `i × 0.11s`，用 `countTo` 各自算当前位的值。**做成真实的连续滚动**（overlay-studio 是 CSS transition 一次性跳到终值，Remotion 下连续滚动反而更简单）。
- **Entity**：横向 flex —— 1~3 块名牌（每块纵向：name `data-slot="chip-{i}-name"` + 可选 sub `data-slot="chip-{i}-sub"`），可选右侧 note。每块 `slideIn(frame, fps, t(0.2 + i*0.5), 'left')`，**进场后常驻**（`slideIn` 本身就是 clamp 到终态，天然常驻）。`tone: 'light'` 用浅底深字、`'dark'` 用深底浅字 + accent 色的 sub。**名牌内的文字不加阴影**（实心色块上会显脏）——若卡片全局有阴影，这里显式覆盖为 `textShadow: 'none'`。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';

/*
 * 新卡的真渲染测试。断言 JSX 没有意义(组件可能渲染出一片空白也"通过"),
 * 只有真渲染出 PNG 比像素才说明画面上真的有东西。手法照 card-style-render.test.ts。
 */
const renderCard = async (card: string, slots: unknown, atMs: number, name: string) => {
  const png = path.join(os.tmpdir(), `${name}-${Date.now()}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [{ shotId: 's1', startMs: 0, endMs: 5000, card, slots }] as never,
      audioSrc: null, bgm: null, captions: [], sourceVideo: null,
      aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs, outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  return { img, cleanup: () => [png, ppm].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)) };
};

/** 画面上有多少非背景像素(背景取同行最左端做参照, 避开 Ambient 暗角渐变)。 */
const countInk = (img: ReturnType<typeof parsePpm>, y0: number, y1: number, x0: number, x1: number) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 4) {
    const bg = readPixel(img, 4, y);
    for (let x = x0; x <= x1; x += 4) {
      if (manhattan(readPixel(img, x, y), bg) > 30) n += 1;
    }
  }
  return n;
};

describe('ring 卡', () => {
  it('画面上有环也有数字', async () => {
    const { img, cleanup } = await renderCard('ring', { label: '四线城市占比', value: 32.2, unit: '%' }, 2000, 'ring');
    try {
      // 环画在画面中部, 数字在环心 —— 中间那块区域必须有明显的墨
      const ink = countInk(img, Math.floor(img.height * 0.3), Math.floor(img.height * 0.7),
        Math.floor(img.width * 0.3), Math.floor(img.width * 0.7));
      expect(ink, '环与数字所在区域应有可见内容').toBeGreaterThan(50);
    } finally { cleanup(); }
  }, 120_000);

  it('ratio 不同 → 环画出的长度不同 → 像素不同', async () => {
    const a = await renderCard('ring', { label: '占比', value: 20 }, 2000, 'ring20');
    const b = await renderCard('ring', { label: '占比', value: 80 }, 2000, 'ring80');
    try {
      const inkA = countInk(a.img, 0, a.img.height - 1, 0, a.img.width - 1);
      const inkB = countInk(b.img, 0, b.img.height - 1, 0, b.img.width - 1);
      expect(inkB, '80% 的环比 20% 的环更长, 墨更多').toBeGreaterThan(inkA);
    } finally { a.cleanup(); b.cleanup(); }
  }, 120_000);
});

describe('odometer 卡', () => {
  it('滚动进行中: 某一帧上个位已停、高位还在动', async () => {
    // 逐位错峰 0.11s: 个位 at=0.3s, 千位 at=0.3+3×0.11=0.63s
    // 取 t=1.0s: 个位(0.3+0.9=1.2s 结束)接近停、千位刚过半 —— 两位数字不同
    const { img, cleanup } = await renderCard('odometer', { label: '累计', value: 1234 }, 1000, 'odo');
    try {
      const ink = countInk(img, Math.floor(img.height * 0.35), Math.floor(img.height * 0.65),
        Math.floor(img.width * 0.25), Math.floor(img.width * 0.75));
      expect(ink, '数字滚轮区域应有可见内容').toBeGreaterThan(50);
    } finally { cleanup(); }
  }, 120_000);
});

describe('entity 卡', () => {
  it('三块名牌逐块滑入: 早期只有第一块可见, 后期三块都在', async () => {
    const chips = [
      { name: 'DeepSeek', sub: 'AI 公司', tone: 'dark' as const },
      { name: '智谱', sub: 'AI 公司', tone: 'light' as const },
      { name: '月之暗面', sub: 'AI 公司', tone: 'dark' as const },
    ];
    // 逐块 0.5s 错峰: 第 1 块 at=0.2s, 第 3 块 at=1.2s
    const early = await renderCard('entity', { chips }, 600, 'ent-early');
    const late = await renderCard('entity', { chips }, 3000, 'ent-late');
    try {
      const band = (img: ReturnType<typeof parsePpm>) => countInk(
        img, Math.floor(img.height * 0.4), Math.floor(img.height * 0.6), 0, img.width - 1,
      );
      expect(band(late.img), '三块都到位后墨应明显多于只有一块时').toBeGreaterThan(band(early.img));
    } finally { early.cleanup(); late.cleanup(); }
  }, 120_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/cards-ring-odometer-entity.test.ts`
Expected: FAIL —— 三张卡还指向 `Statement`（Task 2 的临时指向），渲出来是空白或报槽位不匹配

- [ ] **Step 3: 实现三个组件**

按上面的「三张卡的构成」写。骨架照 `Statement.tsx`/`ListCard.tsx`（`safeBox` 定位、`scaleFont` 定字号、flex 排布、`assertContent` 校验必填、颜色一律读 `theme` 不写死）。`index.ts` 把三张卡换成真实组件。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/cards-ring-odometer-entity.test.ts && npm run typecheck:all`
Expected: 4 条真渲染全过

- [ ] **Step 5: 全量 + 提交**

Run: `npx vitest run`（确认 `card-registry.test.ts` 的「不许绝对坐标」断言没被 SVG 触发——若触发，说明该断言的正则需要放行 SVG 内部属性，**先报告再改断言**）

```bash
git add remotion/src/cards/ tests/
git commit -m "feat(video): 圆环/翻牌/名牌三张卡"
```

---

### Task 4: 两张复杂卡（curve / rank）

**Files:**
- Create: `remotion/src/cards/Curve.tsx` / `Rank.tsx`
- Modify: `remotion/src/cards/index.ts`
- Test: `tests/lib/video-production/cards-curve-rank.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `curveDraw`/`barGrow`/`countTo`、既有 `fadeUp`/`staggerIn`
- Produces: 两个组件

**两张卡的构成（spec §2.3/2.4）：**

- **Curve**：卡片内纵向 —— 顶部一行（左 label `data-slot="label"`、右峰值数字 `data-slot="peak"`）→ SVG 图（曲线 + 渐变面积 + 数据点的圆点与上下标注，每点包一层 `data-slot="point-{i}"`）→ 可选 note。
  - 平滑曲线用 **Catmull-Rom → 三次贝塞尔**转换（纯几何函数，写在组件文件内或 `layout/` 下，附注释说明来源）
  - **一个进度值串三件事**：`draw = curveDraw(frame, fps, t(0.3), 2.0)` → 曲线 `pathLength=1` + `strokeDashoffset={1-draw}`；面积 `opacity={draw}`；每点 `on = clamp((draw - i/(n-1)*0.9) / 0.15, 0, 1)` 控制淡入与半径
  - 峰值数字 `countTo(frame, fps, t(0.3), peak, 2.3)` —— **比曲线晚 0.3s 收尾**（曲线画完时数字刚停）
- **Rank**：纵向列表 —— title → 每行（`data-slot="row-{i}"` 包住）：上半 flex 两端对齐（name `data-slot="row-{i}-name"` / value `data-slot="row-{i}-value"`），下半进度条（轨道 + `barGrow` 的填充）。最高值那行用 accent 色，其余降调。**逐行错峰 0.14s**；**条形 0.9s、数字 1.4s 故意不对齐**（条先到位、数字还在滚，保留这个错落）。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';

const renderCard = async (card: string, slots: unknown, atMs: number, name: string) => {
  const png = path.join(os.tmpdir(), `${name}-${Date.now()}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [{ shotId: 's1', startMs: 0, endMs: 6000, card, slots }] as never,
      audioSrc: null, bgm: null, captions: [], sourceVideo: null,
      aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs, outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  return { img, cleanup: () => [png, ppm].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)) };
};

const countInk = (img: ReturnType<typeof parsePpm>, y0: number, y1: number, x0: number, x1: number) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 4) {
    const bg = readPixel(img, 4, y);
    for (let x = x0; x <= x1; x += 4) {
      if (manhattan(readPixel(img, x, y), bg) > 30) n += 1;
    }
  }
  return n;
};

const POINTS = [
  { at: '1月', value: 100 }, { at: '2月', value: 180 }, { at: '3月', value: 340 },
  { at: '4月', value: 520 }, { at: '5月', value: 900 },
];

describe('curve 卡', () => {
  it('描画进行中: 左半段已画出、右半段还没有', async () => {
    // draw 从 t=0.3s 起 2.0s: 取 t=1.3s 时 draw≈0.5(缓动后更多), 左半必然有、右端必然还没到
    const { img, cleanup } = await renderCard('curve', { label: '搜索量', points: POINTS, unit: '万' }, 1300, 'curve-mid');
    try {
      const midY0 = Math.floor(img.height * 0.35);
      const midY1 = Math.floor(img.height * 0.75);
      const left = countInk(img, midY0, midY1, Math.floor(img.width * 0.15), Math.floor(img.width * 0.35));
      const right = countInk(img, midY0, midY1, Math.floor(img.width * 0.75), Math.floor(img.width * 0.92));
      expect(left, '左半段应已画出').toBeGreaterThan(0);
      expect(right, '右半段此刻应还没画到').toBeLessThan(left);
    } finally { cleanup(); }
  }, 120_000);

  it('画完之后整条曲线都在', async () => {
    const { img, cleanup } = await renderCard('curve', { label: '搜索量', points: POINTS, unit: '万' }, 5000, 'curve-done');
    try {
      const midY0 = Math.floor(img.height * 0.35);
      const midY1 = Math.floor(img.height * 0.75);
      const right = countInk(img, midY0, midY1, Math.floor(img.width * 0.75), Math.floor(img.width * 0.92));
      expect(right, '画完后右半段必须有内容').toBeGreaterThan(0);
    } finally { cleanup(); }
  }, 120_000);
});

describe('rank 卡', () => {
  const ROWS = [
    { name: '四线城市', value: 32 }, { name: '三线城市', value: 27 },
    { name: '二线城市', value: 21 }, { name: '一线城市', value: 20 },
  ];

  it('条形生长: 早期短、后期长', async () => {
    const early = await renderCard('rank', { title: '需求分布', rows: ROWS, suffix: '%' }, 500, 'rank-early');
    const late = await renderCard('rank', { title: '需求分布', rows: ROWS, suffix: '%' }, 4000, 'rank-late');
    try {
      const all = (img: ReturnType<typeof parsePpm>) => countInk(img, 0, img.height - 1, 0, img.width - 1);
      expect(all(late.img), '条形长完之后墨应明显多于刚开始时').toBeGreaterThan(all(early.img));
    } finally { early.cleanup(); late.cleanup(); }
  }, 120_000);

  it('最高值那行与其它行的颜色不同', async () => {
    const { img, cleanup } = await renderCard('rank', { title: '需求分布', rows: ROWS, suffix: '%' }, 4000, 'rank-top');
    try {
      // 逐行扫描, 统计每行区域内出现的最"浓"像素(与背景差最大), 首行应与末行不同
      const rowBand = (idx: number) => {
        const y = Math.floor(img.height * (0.35 + idx * 0.09));
        let maxDiff = 0;
        const bg = readPixel(img, 4, y);
        for (let x = Math.floor(img.width * 0.15); x < Math.floor(img.width * 0.85); x += 3) {
          maxDiff = Math.max(maxDiff, manhattan(readPixel(img, x, y), bg));
        }
        return maxDiff;
      };
      expect(rowBand(0)).toBeGreaterThan(0);
      expect(rowBand(3)).toBeGreaterThan(0);
    } finally { cleanup(); }
  }, 120_000);
});
```

> 最后那条测试只断言「两行都有内容」——**颜色差异的断言留给实施者补强**：读取实现里最高行与普通行的实际色值，改成断言两者色值不同。计划里写不出精确色值（取决于 theme token），这是实施者必须自己补的一步，**报告里要说明补成了什么**。

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现两个组件**（按上面的构成；`index.ts` 换真实组件）
- [ ] **Step 4: 跑测试确认通过 + `npm run typecheck:all`**
- [ ] **Step 5: 全量 + `npm run build` + 提交**

```bash
git add remotion/src/cards/ tests/
git commit -m "feat(video): 增长曲线与排名条两张卡"
```

---

### Task 5: 选卡分布实测 + 文档

**Files:**
- Modify: `README.md`
- 探针脚本放 scratchpad，不进 git

**这一步在验什么**：卡从 4 张扩到 9 张之后，**模型会不会乱选**。二十七期实测过同类现象（卡片描述写不好，模型会扁向某一张），spec §三点名要做前后对比。

- [ ] **Step 1: 跑选卡分布实测**

用既有探针（scratchpad 里的 `spike-connector-rate.ts` 或 `spike-builder-filmplan.ts`，口径照它们）：三条真实六幕稿 × 3 遍 = 9 次独立运行，统计九张卡的分布。

**对比基线**（三十二期之前的四卡时代，探针历史数据）：`statement 54.1% / stat 17.6% / contrast 14.9% / list 13.5%`

**判读标准**（写进报告）：
- 五张新卡**至少有三张**被用到（一次都没被选中说明说明写失败）
- `statement` 占比**不超过 65%**（超过说明模型退回「什么都塞进陈述卡」的老毛病）
- 任何一张新卡**不超过 25%**（某张独大说明它的「什么时候用」写得太宽）

**不达标怎么办**：**只改卡片说明，不改 schema**；改完重测一轮，两轮都不达标就如实报告数据、把问题记进 ledger 交裁决——**不许反复调文案凑数字**（二十七期在 connector 上调了三轮才发现是在噪声里调参）。

- [ ] **Step 2: 人工核对几镜产出**

从实测产出里挑 5 镜新卡，核对：数值有没有编造（对回稿子的 facts 台账）、`ring` 的 max 是否合理、`curve` 的 points 是否真的是时间序列、`entity` 的 chips 是否真是稿子里点名过的主体。

- [ ] **Step 3: README 加三十三期一节**

写清：九张卡各自的用途与界线、五张新卡的动效手法、为下一期留的结构（`data-slot` 标记与 anim 函数）、选卡分布的实测数据。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs(video): 三十三期收尾 —— 九张卡与选卡分布实测"
```

---

## Self-Review

**1. Spec 覆盖** —— §2.1~2.5 五张卡 → Task 2（契约）+ Task 3/4（组件）；§三选卡策略与实测 → Task 5；§四为下一期留的结构（`data-slot`、anim 函数、可拖粒度）→ Task 3/4 的构成说明里逐条写明；§六测试 → 各 Task 自带；§七风险（模型扁向、槽位校验、工作量）→ Task 5 的判读标准 / Task 2 的 strict 测试 / 砍尾巴预案。

**2. 占位扫描** —— 无 TBD。Task 3/4 的组件实现给的是「构成 + 动效参数 + data-slot 命名」而非逐行 JSX：五张卡的排版各不相同，逐行写等于把实现塞进计划；而构成、动效函数与参数、标记命名都是精确的。Task 4 最后一条测试明确标了「颜色断言留给实施者补强，报告说明补成了什么」——这是明知计划写不出精确色值（取决于 theme token）而显式交出去的一步，不是占位。

**3. 类型一致** —— `ringDraw`/`curveDraw`/`barGrow`/`countTo` 在 Task 1 定义、Task 3/4 消费；`CARD_TYPES` 九项的顺序在 Task 2 测试与实现里一致；`data-slot` 命名规则（`label`/`value`/`note`/`chip-{i}-name`/`row-{i}-name`/`point-{i}`）在 Task 3/4 各自的构成说明里写明，下一期的拖拽层按这套查找。

**4. 已知风险** ——
- **Task 2 的临时指向**：五张新卡先指向 `Statement` 让注册表测试通过，Task 3/4 逐个替换。**若 Task 3/4 中途中断，仓库里会留下「选了 ring 却渲出 statement」的状态**——这比报错更糟（静默错误）。缓解：临时指向那行必须带 `TODO(三十三期 Task 3/4)` 注释，且 Task 5 的实测会立刻暴露（渲出来的画面不对）。**若本期砍尾巴，被砍的卡必须从 `CARD_TYPES` 与说明里一并移除，不许留临时指向。**
- **SVG 与「不许绝对坐标」断言**：`card-registry.test.ts` 有一条禁绝对坐标的断言，SVG 内部的 `cx`/`cy`/`d` 属性可能触发它。Task 3 Step 5 点名了：触发就先报告再改断言，不要默默放宽。
- **真渲染测试的耗时**：本期新增约 9 条真渲染（每条渲 1-2 张 PNG）。三十二期实测单帧约 0.6s、全量 52s；本期后全量预计 70-80s，仍可接受。若超过 2 分钟，报告里说明并考虑合并测试用例。
- **`odometer` 的字体度量**：数字滚轮的窗口高度与行高必须精确匹配（`1.15em` 对 `line-height: 1.15`），否则窗口会露出相邻数字。这是实现细节陷阱，Task 3 的构成里写明了。
