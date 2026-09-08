# 模板级样式预设 Implementation Plan（三十六期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模板存一份默认样式（accent/speed/scale），渲染每镜时逐字段合并（镜上显式设置优先），剪辑台显示「跟随模板」态并可覆盖/恢复。

**Architecture:** 合并只发生在 `remotion/src/Film.tsx` 传卡片前的一处（纯函数 `mergeShotStyle`），九张卡与 `style.ts` 三函数零改动。模板默认不写进 FilmPlan——模型三重隔离与「恢复跟随」都靠这一条成立。五个注入点把 `template.defaultShotStyle` 送进渲染输入。

**Tech Stack:** Prisma(Json 可空列)、zod(复用 ShotStyleSchema)、Remotion、vitest 真渲染

**Spec:** `docs/superpowers/specs/2026-09-08-template-style-preset-design.md`

## Global Constraints

- **模型不碰 style**：`stripPlanStyle` 与 `describeCardsForPrompt` 一个字不动；模板默认只进渲染输入，绝不写进 `FilmPlan`。
- **展开语义坑**：`{...a, ...b}` 里 b 的**存在但为 undefined** 的键会覆盖 a——`mergeShotStyle` 必须先剔除 undefined 键，测试钉死。
- **改 Prisma schema 后必须重启 dev 与 worker**（旧 client 把新字段静默读成 undefined，症状是"配了没效果"）。重启方式：`pkill -f 'next dev'; pkill -f 'tsx src/jobs/workers'` 后 `nohup npm run dev:all > /tmp/mediapilot-dev.log 2>&1 &`。
- **不跑 `npm run build`**（控制者在主会话跑）。dev server 在 3000 端口，不许杀了不起（重启见上）。临时文件放 /tmp，绝不放 src/ 下。
- 注释中文讲「为什么」；提交 `git add` 逐个点名文件；提交信息结尾带：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## File Structure

| 文件 | 职责 |
| --- | --- |
| `remotion/src/cards/style.ts`（修改） | 新增 `mergeShotStyle` 纯函数（唯一合并逻辑） |
| `remotion/src/Film.tsx`（修改） | `FilmInput` 加 `templateStyle?`；渲卡处用合并值 |
| `prisma/schema.prisma` + `src/lib/video-template/model.ts`（修改） | `defaultShotStyle` 列与配置类型/校验 |
| 模板 GET/PUT/duplicate 三条 API（修改） | 字段读写与复制 |
| `src/lib/video-production/remotion-render.ts`（修改） | `FilmInput` 同形加字段（两侧不 import 惯例） |
| `src/jobs/workers/video-production-worker.ts` 等五个注入点（修改） | 把模板默认送进渲染输入 |
| `src/components/templates/template-editor.tsx`（修改) | 「默认样式」编辑块 |
| `scripts/generate-template-demos.ts`（修改） | 演示渲染带默认样式；指纹算入 |
| `src/components/films/film-plan-workbench.tssx→tsx` `StyleControls`（修改） | 「跟随模板」态 |

---

### Task 1: mergeShotStyle 纯函数

**Files:**
- Modify: `remotion/src/cards/style.ts`
- Test: `tests/lib/video-production/merge-shot-style.test.ts`（新建）

**Interfaces:**
- Produces: `mergeShotStyle(templateStyle?: ShotStyle | null, shotStyle?: ShotStyle | null): ShotStyle` —— 后续所有任务用这一个名字。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { mergeShotStyle } from '../../remotion/src/cards/style';

describe('mergeShotStyle: 模板默认与逐镜覆盖的合并', () => {
  it('逐字段合并: 镜只覆盖了 accent, speed 仍跟模板', () => {
    expect(mergeShotStyle({ accent: 'blue', speed: 2 }, { accent: 'red' }))
      .toEqual({ accent: 'red', speed: 2 });
  });

  it('undefined 不覆盖 —— {...a,...b} 的展开语义里 b 存在但为 undefined 的键会盖掉 a, 这里必须剔除', () => {
    expect(mergeShotStyle({ accent: 'blue' }, { accent: undefined, speed: 1.5 }))
      .toEqual({ accent: 'blue', speed: 1.5 });
  });

  it('两侧都空返回空对象; null 与 undefined 同义', () => {
    expect(mergeShotStyle(null, undefined)).toEqual({});
    expect(mergeShotStyle(undefined, null)).toEqual({});
  });

  it('模板为空时镜上值原样通过', () => {
    expect(mergeShotStyle(null, { scale: 1.2 })).toEqual({ scale: 1.2 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/merge-shot-style.test.ts`
Expected: FAIL —— `mergeShotStyle` 不存在

- [ ] **Step 3: 实现**

追加到 `remotion/src/cards/style.ts`：

```ts
/** 剔除值为 undefined 的键 —— {...a, ...b} 里 b 的 undefined 键**存在**时会覆盖 a, 直接展开是错的。 */
const compact = (s?: ShotStyle | null): Partial<ShotStyle> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s ?? {})) if (v !== undefined) out[k] = v;
  return out as Partial<ShotStyle>;
};

/**
 * 模板默认样式与逐镜覆盖的合并(三十六期)。逐字段: 镜上显式设置的字段优先,
 * 没设的用模板默认。**唯一合并点** —— Film.tsx 渲卡前调它, 剪辑台面板显示
 * "跟随模板(当前:×)"也调它, 两处永远一致。
 */
export const mergeShotStyle = (
  templateStyle?: ShotStyle | null, shotStyle?: ShotStyle | null,
): ShotStyle => ({ ...compact(templateStyle), ...compact(shotStyle) });
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

```bash
git add remotion/src/cards/style.ts tests/lib/video-production/merge-shot-style.test.ts
git commit -m "feat(video): mergeShotStyle —— 模板默认样式的唯一合并点"
```

---

### Task 2: 数据层（schema + 模板 API）

**Files:**
- Modify: `prisma/schema.prisma`（`model VideoTemplate` 内加一行）
- Modify: `src/lib/video-template/model.ts`（`VideoTemplateConfig` + zod）
- Modify: `src/app/api/v1/video-templates/route.ts`、`[id]/route.ts`、`[id]/duplicate/route.ts`
- Modify: `src/app/templates/[id]/page.tsx`（config 组装处补字段，锚点：`brollEnabled: t.brollEnabled ?? true,` 那行附近）
- Test: `tests/api/video-templates/default-shot-style.test.ts`（新建）

**Interfaces:**
- Consumes: `ShotStyleSchema`/`ShotStyle`（`src/lib/video-production/shot-plan.ts` 已导出）
- Produces: `VideoTemplate.defaultShotStyle: Json?`；`VideoTemplateConfig.defaultShotStyle: ShotStyle | null`

- [ ] **Step 1: schema 加列并推库**

`prisma/schema.prisma` 的 `model VideoTemplate` 内（`brollEnabled` 附近）加：

```prisma
  defaultShotStyle Json? // 三十六期: 模板级默认样式 {accent?,speed?,scale?}, 渲染时与逐镜 style 合并
```

Run: `npx prisma db push && npx prisma generate`
然后**重启 dev 与 worker**（Global Constraints 里的命令）——不重启, 新字段静默读成 undefined。

- [ ] **Step 2: 写失败的 API 测试**

照 `tests/api/video-templates/crud.test.ts` 的 mock 手法（prismaMock + getOrCreateDefaultUser mock）写四条：

```ts
// 1. PUT 带 { defaultShotStyle: { accent: 'red', speed: 1.5 } } → prismaMock.videoTemplate.update
//    收到 data.defaultShotStyle 与之相等
// 2. PUT 带非法值 { defaultShotStyle: { speed: 5 } } → 400, update 不被调
// 3. PUT 带 { defaultShotStyle: null } → 落 null(清除预设)
// 4. duplicate: 源模板有 defaultShotStyle → create 的 data 里原样带上
```

（测试文件完整骨架照抄 `crud.test.ts` 顶部的 mock 段，此处四条的断言目标已写明——实施者按既有文件的写法补齐 request 构造。）

- [ ] **Step 3: 跑测试确认失败**
- [ ] **Step 4: 实现**

`model.ts`：`VideoTemplateConfig` 加 `defaultShotStyle: ShotStyle | null`；配置 zod 加
`defaultShotStyle: ShotStyleSchema.nullable()`（import 自 shot-plan.ts）。
三条 API：GET 返回 `(t.defaultShotStyle as ShotStyle | null) ?? null`；PUT 写
`defaultShotStyle: cfg.defaultShotStyle ?? undefined`——**注意 Prisma 对"清除"要写
`Prisma.JsonNull`**，照 `voicePreset` 既有写法处理 null；duplicate 加
`defaultShotStyle: src.defaultShotStyle,`。
`templates/[id]/page.tsx` 的 config 组装加 `defaultShotStyle: (t.defaultShotStyle as ShotStyle | null) ?? null,`。

- [ ] **Step 5: 跑测试 + `npm run typecheck` 确认通过**
- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma src/lib/video-template/model.ts src/app/api/v1/video-templates/ src/app/templates/\[id\]/page.tsx tests/api/video-templates/default-shot-style.test.ts
git commit -m "feat(templates): defaultShotStyle 列与模板 API 读写"
```

---

### Task 3: 渲染注入（五个注入点 + 真渲染 A/B）

**Files:**
- Modify: `remotion/src/Film.tsx`（`FilmInput` 类型 + 第 218 行渲卡处）
- Modify: `src/lib/video-production/remotion-render.ts`（`FilmInput` 同形加字段）
- Modify: `src/jobs/workers/video-production-worker.ts`（组装 input 两处，489/918 行附近）
- Modify: `src/app/api/v1/cockpit/video-productions/[id]/film-plan/route.ts`（meta 加 templateStyle）
- Modify: `src/app/api/v1/cockpit/video-productions/[id]/shot-still/[shotIndex]/route.ts`（input 加 templateStyle）
- Modify: `src/components/films/plan-preview.tsx`（props + 两处 inputProps）
- Test: `tests/lib/video-production/template-style-render.test.ts`（新建，真渲染）

**Interfaces:**
- Consumes: Task 1 的 `mergeShotStyle`；Task 2 的 `defaultShotStyle` 字段
- Produces: `FilmInput.templateStyle?: ShotStyle`（两侧同形不 import，惯例同 `CaptionItem`）；film-plan GET meta 多一个 `templateStyle: ShotStyle | null` 字段（Task 5 消费）

- [ ] **Step 1: 写失败的真渲染测试**

判据沿用三十三期规矩：**同一时刻、内容一致、逐像素互比**（`_ppm-test-utils` 的
`parsePpm/readPixel/manhattan`；renderCard 辅助照 `cards-ring-odometer-entity.test.ts` 抄，
input 多带 `templateStyle`）：

```ts
// 同一镜 statement 卡, 同一 atMs=2000:
// A = 无 templateStyle; B = templateStyle {accent:'red'}
// 断言: A/B 逐像素差分 > 50(strong 色进了画面);
// C = templateStyle {accent:'red'} 且 shot.style {accent:'blue'} → C 与 B 差分 > 50(镜上覆盖生效)
// D = templateStyle {scale:0.8} vs A → 差分 > 50(缩放生效, 证明不只 accent 接通)
```

- [ ] **Step 2: 跑测试确认失败**（templateStyle 字段还不存在，渲染结果 A=B）
- [ ] **Step 3: 实现**

`Film.tsx`：`FilmInput` 加 `templateStyle?: ShotStyle`（`ShotStyle` 类型该文件同形声明或
从 `./cards/style` import——style.ts 在 remotion 子项目内，**可以** import）；渲卡行改：

```tsx
<Card slots={s.slots} durationInFrames={dur} theme={theme} style={mergeShotStyle(templateStyle, s.style)} />
```

`remotion-render.ts`：`FilmInput` 类型加 `templateStyle?: { speed?: number; accent?: 'default' | 'blue' | 'yellow' | 'red'; scale?: number };`（同形不 import 注释照 `CaptionItem` 惯例写）。
worker 两处组装 input 时加 `templateStyle: (template?.defaultShotStyle as FilmInput['templateStyle']) ?? undefined,`。
film-plan GET：meta 加 `templateStyle: (template?.defaultShotStyle as ShotStyle | null) ?? null,`。
shot-still route：组装 input 处同 worker 写法。
`plan-preview.tsx`：`PlanPreviewProps` 加 `templateStyle?: PreviewShotStyle | null`；两处 inputProps 加 `templateStyle: props.templateStyle ?? undefined`。

- [ ] **Step 4: 跑测试确认通过 + 变异验证**

变异：把 Film.tsx 渲卡行改回 `style={s.style}`，A/B 差分归零 → 测试转红；改回后再绿。
报告里写变异前后的实测差分数值。

- [ ] **Step 5: 全量 + 提交**

Run: `npx vitest run tests/lib/video-production/ && npm run typecheck:all`

```bash
git add remotion/src/Film.tsx src/lib/video-production/remotion-render.ts src/jobs/workers/video-production-worker.ts src/app/api/v1/cockpit/video-productions/ src/components/films/plan-preview.tsx tests/lib/video-production/template-style-render.test.ts
git commit -m "feat(video): templateStyle 注入五个渲染入口, Film.tsx 单点合并"
```

---

### Task 4: 模板编辑器「默认样式」块 + 演示指纹

**Files:**
- Modify: `src/components/templates/template-editor.tsx`（「画面」节内，视觉风格 Row 之后）
- Modify: `scripts/generate-template-demos.ts`（指纹 + 渲染输入）
- Test: `tests/components/template-default-style.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 2 的 `VideoTemplateConfig.defaultShotStyle`
- Produces: `templateDemoHash` 的 key 数组末尾追加 `t.defaultShotStyle ?? null`（模板页 import 同一函数，自动一致）

- [ ] **Step 1: 写失败的测试**

```ts
// 1. templateDemoHash: defaultShotStyle 从 null 变 {accent:'red'} → 返回值变化
// 2. templateDemoHash: 其余字段全同、defaultShotStyle 同 → 返回值不变(回归)
// 渲染部分不在组件测试里验(Task 3 已真渲染验过 templateStyle 通路)
```

编辑器块用真机验收，不写 jsdom 渲染测试（Choice/滑杆是纯展示绑定，jsdom 测不出对错——
这是三十二期就定下的取舍，照旧）。

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

编辑器（「画面」节 `视觉风格` Row 后）加三行控件，全部走 `set('defaultShotStyle', ...)`：

- 强调色：`Choice`，选项 `未设置(null 该键) / default(跟随主题) / blue / yellow / red`
- 速度：`range 0.3~3 step 0.1` + 当前值显示 + 「未设置」清除小按钮
- 缩放：`range 0.6~1.6 step 0.05` + 同上
- Row hint：「默认值，剪辑台可逐镜覆盖。改完保存后上方效果演示会提示重新生成。」
- 实现注意：`defaultShotStyle` 为 null 与 `{}` 都合法，**清到最后一个字段时写回 null**
  （空对象在 UI 上和 null 无法区分，统一成 null 免得指纹出两个值）。

`generate-template-demos.ts`：
- `templateDemoHash` 的 select 与 key 数组加 `defaultShotStyle`；
- `prisma.videoTemplate.findMany` 的 select 加 `defaultShotStyle: true`；
- 渲染 input 加 `templateStyle: (t.defaultShotStyle as FilmInput['templateStyle']) ?? undefined`。
- 模板列表/详情页 select 处同步加 `defaultShotStyle`（详情页 Task 2 已加；`templateDemoHash` 的
  入参类型加字段后，两个页面的调用点 typecheck 会替你找齐——红一个补一个）。

- [ ] **Step 4: 跑测试 + typecheck 通过；`FORCE=1 npm run gen:template-demos` 重渲一遍确认脚本还能跑**
- [ ] **Step 5: 提交**

```bash
git add src/components/templates/template-editor.tsx scripts/generate-template-demos.ts tests/components/template-default-style.test.tsx src/app/templates/page.tsx src/app/templates/\[id\]/page.tsx
git commit -m "feat(templates): 默认样式编辑块 + 演示指纹算入 defaultShotStyle"
```

---

### Task 5: 剪辑台「跟随模板」态 + README

**Files:**
- Modify: `src/components/films/film-plan-workbench.tsx`（`StyleControls`，900 行附近）
- Modify: `README.md`
- Test: `tests/components/workbench-follow-template.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 3 的 film-plan GET meta `templateStyle`；Task 1 的 `mergeShotStyle`

- [ ] **Step 1: 写失败的测试**

`StyleControls` 已可单测（props 进 props 出）。三条：

```ts
// 1. templateStyle={accent:'red'} 且 shot.style 无 accent → 强调色控件旁出现「跟随模板」字样,
//    且当前显示值为 red(来自 mergeShotStyle)
// 2. shot.style={accent:'blue'} → 显示「已覆盖」态(恢复按钮可点), 显示值 blue
// 3. 点「恢复跟随」→ onReset('accent') 被调(既有回调, 语义就是删字段)
```

（`StyleControls` 目前未导出——导出它，理由同三十三期 Task 4.5：能被单测看见的东西才有人在改坏后发现。）

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

- `StyleControls` 加 prop `templateStyle?: ShotStyle | null`；缺省显示值改为
  `mergeShotStyle(templateStyle, style)[ctrl.key] ?? 内建缺省`；
- 未覆盖且模板有该字段时，label 后缀「· 跟随模板」；已覆盖时沿用现有「恢复默认」按钮，
  文案改「恢复跟随」（模板没设该字段时仍叫「恢复默认」——恢复的目标不同，文案要如实）;
- 顶部那段「与渲染层缺省值逐条对齐」注释更新为「初始显示值 = mergeShotStyle(templateStyle, {})，
  与 Film.tsx 的合并同源」；
- workbench 从 film-plan GET 的 meta 里取 `templateStyle` 传下来（meta 已在 state 里，
  加字段即可）；`plan-preview` 的调用点带上 `templateStyle`（Task 3 已加 prop）。

- [ ] **Step 4: 跑测试 + `npx vitest run tests/components/` + typecheck 全绿**
- [ ] **Step 5: README + 提交**

README 三十五期节后加「模板级样式预设（三十六期）」小节：合并语义（逐字段、镜上优先）、
唯一合并点、模板默认不进 FilmPlan、指纹联动演示。

```bash
git add src/components/films/film-plan-workbench.tsx src/components/films/plan-preview.tsx tests/components/workbench-follow-template.test.tsx README.md
git commit -m "feat(films): 剪辑台样式面板接模板默认 —— 跟随/覆盖/恢复三态"
```

---

## Self-Review

**1. Spec 覆盖**：§3.1→Task 2；§3.2→Task 1+3；§3.3 五个注入点→Task 3（worker×2/shot-still/film-plan GET/plan-preview）+ Task 4（demo 脚本）；§3.4→Task 4；§3.5→Task 5；§四测试 1/2/3/4/5 → Task 1/3/2/3/4。无缺口。
**2. 占位扫描**：Task 2 Step 2 与 Task 4/5 的测试给的是断言目标清单而非逐行代码——mock 骨架在既有文件里逐字可抄（crud.test.ts / 三十三期先例），此为引用既有真源而非占位。编辑器/面板给「构成+锚点」，同三十三期计划的既定取舍。
**3. 类型一致**：`mergeShotStyle(templateStyle, shotStyle): ShotStyle` 全程一名；`FilmInput.templateStyle` 两侧同形；meta 字段名 `templateStyle` 在 Task 3 产出、Task 5 消费一致。
**4. 已知风险**：Prisma 旧 client（Task 2 Step 1 里显式重启步骤）；展开语义坑（Task 1 测试第 2 条钉死）；`Prisma.JsonNull` 清除语义（Task 2 Step 4 点名照 voicePreset 抄）。
