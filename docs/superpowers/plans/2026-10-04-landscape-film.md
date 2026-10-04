# 横版成片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 出片时可选横版（1920×1080，内容区 1360×765），流程与竖版一致；竖版与旧片子完全不变。

**Architecture:** kit 增加按版式取值的 `LAYOUT` 与 React context（`OrientationProvider` / `useLayout`），`Frame` 和字幕从 context 取区块；版式写在片子目录 `data.json`，由脚本生成的 `index.tsx` 设画框尺寸并包 provider。`mp film new --landscape` 建横版目录，`film check` 校验版式（含 `--expect`），登记时记下版式；出片助手可选横版，改片沿用基础版本的版式。

**Tech Stack:** Remotion 4、React context、Next.js 14、Prisma 5、vitest。

**Spec:** `docs/superpowers/specs/2026-10-04-landscape-film-design.md`

## Global Constraints

- 横版画框 1920×1080；内容区 `{left:96, top:120, width:1360, height:765}`；小窗 `{left:1488, top:120, width:336, height:448}`；段落标题 `{left:1488, top:568, width:336, height:317}`；字幕 `{left:96, top:905, width:1360, height:100}`。
- 横版遮挡区 `LANDSCAPE_OVERLAYS`：顶部 0–120、底部 1005–1080、左右各 96。
- 竖版数值（`W`、`H`、`ZONE`、`DOUYIN_OVERLAYS`）不变；`tests/remotion/safe-zone.test.ts` 现有用例不改。
- `data.json` 无 `orientation` = 竖版；`mp film new` 不带 `--landscape` 时输出与现在逐字一致（不写 `orientation` 键、`index.tsx` 不变）。
- 白名单不变。
- 横版首轮消息："给项目 <id>（<标题>）出一版横版成片（画面 1920×1080）。用 `npm run -s mp -- film new <id> --landscape` 建片子目录，检查时用 `npm run -s mp -- film check <片子目录> --expect landscape`。<要求>"；竖版消息不变。

## Review Focus

1. **旧片子（v1–v3，`data.json` 没有 orientation）**：仍按竖版检查与渲染。→ Task 2 测试 `treats a film without orientation as portrait`。
2. **出片时 Claude 改写了横版的 `index.tsx`，把 provider 弄丢**：`film check` 不通过（否则会渲染成竖版区块塞进横版画框）。→ Task 2 测试 `fails a landscape film whose index.tsx lost the provider`。
3. **改片的基础版本是横版、页面开关停在竖版**：仍出横版。→ Task 4 测试 `revise follows the base version orientation`。
4. **横版长字幕**：每行不超过 1360 宽。→ Task 1 测试 `fits long landscape subtitles in 1360`。
5. **`--expect` 写错值（如 `--expect horizontal`）**：明确报错而不是当作通过。→ Task 2 测试 `rejects an unknown --expect value`。

---

## 文件结构

```
remotion/kit/tokens.ts        + Orientation、LANDSCAPE_ZONE、LANDSCAPE_OVERLAYS、LAYOUT、layoutFor
remotion/kit/layout.tsx       OrientationProvider / useLayout(新)
remotion/kit/Frame.tsx        区块取自 useLayout
remotion/kit/Captions.tsx     字幕区取自 useLayout
remotion/kit/index.ts         导出 layout
src/lib/film/orientation.ts   FilmOrientation、isFilmOrientation、orientationLabel(新)
src/lib/film/scaffold.ts      scaffoldFilm(..., { orientation }) + 横版 index 模板
src/lib/film/check.ts         checkOrientation
src/lib/cli/commands/film.ts  film new --landscape、film check --expect、输出版式
src/lib/film/register.ts      meta.orientation
src/lib/project/view.ts       FilmView.orientation
src/components/project/film-pane.tsx    「横版」标记、全宽播放
prisma/schema.prisma          FilmSession.orientation
src/lib/film-session/args.ts  firstMessage 横版
src/lib/film-session/runner.ts startFilm 版式(新出用参数, 改片读基础版本)
src/app/api/projects/[id]/film-session/route.ts  start 传 orientation
src/components/project/film-assistant.tsx       竖版/横版选择
.claude/skills/produce-film/SKILL.md、README.md
```

---

### Task 1: kit 按版式取布局

**Files:**
- Modify: `remotion/kit/tokens.ts`、`remotion/kit/Frame.tsx`、`remotion/kit/Captions.tsx`、`remotion/kit/index.ts`
- Create: `remotion/kit/layout.tsx`
- Test: `tests/remotion/landscape-zone.test.ts`

**Interfaces:**
- Produces（`remotion/kit`）：
  - `type Orientation = 'portrait' | 'landscape'`
  - `LANDSCAPE_ZONE`、`LANDSCAPE_OVERLAYS`、`LAYOUT: Record<Orientation, { W: number; H: number; ZONE: Zones; OVERLAYS: Record<string, Rect> }>`
  - `layoutFor(o: unknown)`：合法值取对应布局，否则竖版
  - `OrientationProvider({ value, children })`、`useLayout()`

- [ ] **Step 1: 写失败测试 `tests/remotion/landscape-zone.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DOUYIN_OVERLAYS, H, LANDSCAPE_OVERLAYS, LANDSCAPE_ZONE, LAYOUT, W, ZONE, layoutFor } from '../../remotion/kit/tokens';
import { captionLayout, displayWidth } from '../../remotion/kit/text';

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('landscape layout', () => {
  it('is 1920×1080 with the agreed zones', () => {
    expect(LAYOUT.landscape.W).toBe(1920);
    expect(LAYOUT.landscape.H).toBe(1080);
    expect(LANDSCAPE_ZONE).toEqual({
      content: { left: 96, top: 120, width: 1360, height: 765 },
      pip: { left: 1488, top: 120, width: 336, height: 448 },
      title: { left: 1488, top: 568, width: 336, height: 317 },
      captions: { left: 96, top: 905, width: 1360, height: 100 },
    });
    expect(LANDSCAPE_ZONE.content.width / LANDSCAPE_ZONE.content.height).toBeCloseTo(16 / 9, 2);
  });
  it('keeps every zone clear of the generic 16:9 overlays and inside the frame', () => {
    for (const [name, z] of Object.entries(LANDSCAPE_ZONE)) {
      for (const [o, r] of Object.entries(LANDSCAPE_OVERLAYS)) expect(overlaps(z, r), `${name} 被 ${o} 挡住`).toBe(false);
      expect(z.left + z.width).toBeLessThanOrEqual(1920 - 96);
      expect(z.top + z.height).toBeLessThanOrEqual(1080);
    }
  });
  it('leaves the portrait layout exactly as it was', () => {
    expect(LAYOUT.portrait).toEqual({ W, H, ZONE, OVERLAYS: DOUYIN_OVERLAYS });
    expect([W, H]).toEqual([1080, 1920]);
  });
  it('falls back to portrait for a missing or unknown orientation', () => {
    expect(layoutFor(undefined)).toBe(LAYOUT.portrait);
    expect(layoutFor('horizontal')).toBe(LAYOUT.portrait);
    expect(layoutFor('landscape')).toBe(LAYOUT.landscape);
  });
  it('fits long landscape subtitles in 1360', () => {
    const t = '今天我们来聊一聊OpenClaw这个开源项目到底怎么用才能真正提升效率不踩坑呢朋友们大家好';
    const l = captionLayout(t, LANDSCAPE_ZONE.captions.width);
    expect(l.rows.join('')).toBe(t);
    for (const r of l.rows) expect(displayWidth(r) * l.fontSize).toBeLessThanOrEqual(LANDSCAPE_ZONE.captions.width - 60);
    expect(captionLayout('半年后干到类目第一', LANDSCAPE_ZONE.captions.width)).toEqual({ fontSize: 50, rows: ['半年后干到类目第一'] });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remotion/landscape-zone.test.ts`
Expected: FAIL（`LANDSCAPE_ZONE` 等未导出）。

- [ ] **Step 3: `tokens.ts` 追加（放在 `ZONE` 之后）**

```ts
export type Orientation = 'portrait' | 'landscape';
type Zones = { pip: Rect; title: Rect; content: Rect; captions: Rect };

/** 横版 1920×1080: 通用 16:9 安全区(平台未定) —— 顶部标题栏/暂停浮层、底部进度条/控件、左右边距 */
const LW = 1920;
const LH = 1080;
export const LANDSCAPE_OVERLAYS: Record<'top' | 'bottom' | 'left' | 'right', Rect> = {
  top: { left: 0, top: 0, width: LW, height: 120 },
  bottom: { left: 0, top: 1005, width: LW, height: LH - 1005 },
  left: { left: 0, top: 0, width: 96, height: LH },
  right: { left: LW - 96, top: 0, width: 96, height: LH },
};

/** 横版: 左边内容区正好 16:9(录屏等比铺满不裁), 右栏上小窗下段落标题, 字幕在内容区下方 */
export const LANDSCAPE_ZONE: Zones = {
  content: { left: 96, top: 120, width: 1360, height: 765 },
  pip: { left: 1488, top: 120, width: 336, height: 448 },
  title: { left: 1488, top: 568, width: 336, height: 317 },
  captions: { left: 96, top: 905, width: 1360, height: 100 },
};

export const LAYOUT: Record<Orientation, { W: number; H: number; ZONE: Zones; OVERLAYS: Record<string, Rect> }> = {
  portrait: { W, H, ZONE, OVERLAYS: DOUYIN_OVERLAYS },
  landscape: { W: LW, H: LH, ZONE: LANDSCAPE_ZONE, OVERLAYS: LANDSCAPE_OVERLAYS },
};

/** 没写或写错的版式一律按竖版(旧片子 data.json 没有 orientation) */
export const layoutFor = (o: unknown) => (o === 'landscape' ? LAYOUT.landscape : LAYOUT.portrait);
```

（`ZONE` 的类型注解改为 `Zones`，数值不动。）

- [ ] **Step 4: 新建 `remotion/kit/layout.tsx`**

```tsx
import React, { createContext, useContext } from 'react';
import { layoutFor, type Orientation } from './tokens';

const OrientationCtx = createContext<Orientation>('portrait');

/** 片子目录的 index.tsx 用它包住 Film: 画框、小窗、字幕按版式取区块, Film.tsx 不用关心 */
export const OrientationProvider: React.FC<{ value: Orientation; children: React.ReactNode }> = ({ value, children }) => (
  <OrientationCtx.Provider value={value}>{children}</OrientationCtx.Provider>
);

export const useLayout = () => layoutFor(useContext(OrientationCtx));
```

`index.ts` 加 `export * from './layout';`。

- [ ] **Step 5: `Frame.tsx` / `Captions.tsx` 改用 `useLayout()`**

`Frame.tsx`：去掉 `ZONE` 的导入；组件改为函数体，开头 `const { ZONE: Z } = useLayout();`，把 `ZONE.title`、`ZONE.content`、`ZONE.pip` 换成 `Z.title`、`Z.content`、`Z.pip`；`import { useLayout } from './layout';`。

`Captions.tsx`：组件开头（`useCurrentFrame` 之前）加 `const { ZONE: Z } = useLayout();`，把 `ZONE.captions` 全部换成 `Z.captions`；去掉 `ZONE` 导入，加 `import { useLayout } from './layout';`。

- [ ] **Step 6: 测试、类型检查、提交**

Run: `npx vitest run tests/remotion && (cd remotion && npx tsc --noEmit) && npm run typecheck`
Expected: 全绿（含现有 `safe-zone.test.ts`）。

```bash
git add remotion/kit tests/remotion/landscape-zone.test.ts
git commit -m "feat(remotion): kit 按版式取布局(横版 1920×1080, 内容区 1360×765), 竖版数值不变

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 建横版片子目录与版式检查

**Files:**
- Create: `src/lib/film/orientation.ts`
- Modify: `src/lib/film/scaffold.ts`、`src/lib/film/check.ts`、`src/lib/cli/commands/film.ts`
- Test: `tests/lib/film/scaffold.test.ts`、`tests/lib/film/check.test.ts`、`tests/lib/cli/film.test.ts`（追加）

**Interfaces:**
- Produces：
  - `type FilmOrientation = 'portrait' | 'landscape'`；`isFilmOrientation(v: unknown): v is FilmOrientation`；`orientationLabel(o: FilmOrientation): '横版' | '竖版'`
  - `scaffoldFilm(bundle, version, root?, opts?: { orientation?: FilmOrientation })`
  - `checkOrientation(data: { orientation?: unknown }, indexSrc: string, expect?: string | true): { orientation: FilmOrientation; issues: string[] }`
  - `film check` 的返回 `{ passed: true; orientation: FilmOrientation }`，输出 `film check 通过（横版）` / `film check 通过（竖版）`

- [ ] **Step 1: 写失败测试**

`tests/lib/film/scaffold.test.ts` 追加（在 `describe('scaffoldFilm', ...)` 内）：

```ts
  it('writes a landscape film when asked and leaves portrait output unchanged', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const land = await scaffoldFilm(await bundleIn(dir), 1, root, { orientation: 'landscape' });
    expect(JSON.parse(await fs.readFile(path.join(land, 'data.json'), 'utf8')).orientation).toBe('landscape');
    const idx = await fs.readFile(path.join(land, 'index.tsx'), 'utf8');
    expect(idx).toContain('<OrientationProvider value="landscape">');
    expect(idx).toContain('width={LAYOUT.landscape.W} height={LAYOUT.landscape.H}');
    const por = await scaffoldFilm(await bundleIn(dir), 2, root);
    expect('orientation' in JSON.parse(await fs.readFile(path.join(por, 'data.json'), 'utf8'))).toBe(false);
    expect(await fs.readFile(path.join(por, 'index.tsx'), 'utf8')).toContain('width={W} height={H}');
    expect(await fs.readFile(path.join(por, 'index.tsx'), 'utf8')).not.toContain('OrientationProvider');
  });
```

`tests/lib/film/check.test.ts` 追加：

```ts
import { checkOrientation } from '@/lib/film/check';

describe('checkOrientation', () => {
  const LAND_INDEX = '<OrientationProvider value="landscape">';
  it('treats a film without orientation as portrait', () => {
    expect(checkOrientation({}, 'width={W} height={H}')).toEqual({ orientation: 'portrait', issues: [] });
  });
  it('accepts a landscape film with its provider', () => {
    expect(checkOrientation({ orientation: 'landscape' }, LAND_INDEX, 'landscape')).toEqual({ orientation: 'landscape', issues: [] });
  });
  it('fails a landscape film whose index.tsx lost the provider', () => {
    expect(checkOrientation({ orientation: 'landscape' }, 'width={W} height={H}').issues).toEqual(['横版片子的 index.tsx 被改动了（缺少 OrientationProvider）：不要改 index.tsx，用 film new --landscape 重建']);
  });
  it('fails an unknown orientation value', () => {
    expect(checkOrientation({ orientation: 'wide' }, '').issues).toEqual(['data.json 里的版式不认识：wide（只能是 portrait 或 landscape）']);
  });
  it('fails when the film does not match the expected orientation', () => {
    expect(checkOrientation({}, '', 'landscape').issues).toEqual(['要横版，但这个片子目录是竖版：用 film new --landscape 重建']);
    expect(checkOrientation({ orientation: 'landscape' }, LAND_INDEX, 'portrait').issues).toEqual(['要竖版，但这个片子目录是横版：用 film new 重建']);
  });
  it('rejects an unknown --expect value', () => {
    expect(checkOrientation({}, '', 'horizontal').issues).toEqual(['--expect 只能是 landscape 或 portrait']);
    expect(checkOrientation({}, '', true).issues).toEqual(['--expect 只能是 landscape 或 portrait']);
  });
});
```

`tests/lib/cli/film.test.ts` 追加：

```ts
  it('film check says which orientation passed', () => {
    const check = FILM_COMMANDS.find((c) => c.path.join(' ') === 'film check')!;
    expect(check.format!({ passed: true, orientation: 'landscape' })).toBe('film check 通过（横版）');
    expect(check.format!({ passed: true, orientation: 'portrait' })).toBe('film check 通过（竖版）');
    expect(check.usage).toBe('mp film check <片子目录> [--expect landscape|portrait]');
    expect(FILM_COMMANDS.find((c) => c.path.join(' ') === 'film new')!.usage).toBe('mp film new <项目> [--landscape]');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film tests/lib/cli/film.test.ts`
Expected: FAIL（新用例）。

- [ ] **Step 3: 新建 `src/lib/film/orientation.ts`**

```ts
/** 片子版式(与 remotion/kit 的 Orientation 同值; 主项目不直接引用 remotion 子工程) */
export type FilmOrientation = 'portrait' | 'landscape';

export const isFilmOrientation = (v: unknown): v is FilmOrientation => v === 'portrait' || v === 'landscape';

export const orientationLabel = (o: FilmOrientation) => (o === 'landscape' ? '横版' : '竖版');
```

- [ ] **Step 4: `scaffold.ts`**

`INDEX` 下方加：

```ts
const INDEX_LANDSCAPE = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, LAYOUT, OrientationProvider } from '../../kit';
import data from './data.json';
import { Film } from './Film';

/** 横版: 画框 1920×1080; 区块由 OrientationProvider 传给画框与字幕, Film.tsx 不用管版式。不要改这个文件。 */
const Root: React.FC = () => (
  <OrientationProvider value="landscape">
    <Film />
  </OrientationProvider>
);

registerRoot(() => (
  <Composition id="Film" component={Root} durationInFrames={Math.ceil(data.durationSec * FPS)} fps={FPS} width={LAYOUT.landscape.W} height={LAYOUT.landscape.H} />
));
`;
```

`scaffoldFilm` 签名改为 `scaffoldFilm(bundle: FilmBundle, version: number, root = filmsRoot(), opts: { orientation?: FilmOrientation } = {})`；`const landscape = opts.orientation === 'landscape';`；`data` 对象末尾加 `...(landscape ? { orientation: 'landscape' } : {}),`；写 `index.tsx` 改为 `landscape ? INDEX_LANDSCAPE : INDEX`。导入 `import type { FilmOrientation } from './orientation';`。

- [ ] **Step 5: `check.ts` 追加**

```ts
import { isFilmOrientation, orientationLabel, type FilmOrientation } from './orientation';

/** 版式: 不认识的值、横版 index.tsx 丢了 provider、与 --expect 不符, 都不通过 */
export function checkOrientation(data: { orientation?: unknown }, indexSrc: string, expect?: string | true): { orientation: FilmOrientation; issues: string[] } {
  const issues: string[] = [];
  const raw = data.orientation;
  if (raw !== undefined && !isFilmOrientation(raw)) issues.push(`data.json 里的版式不认识：${String(raw)}（只能是 portrait 或 landscape）`);
  const orientation: FilmOrientation = raw === 'landscape' ? 'landscape' : 'portrait';
  if (orientation === 'landscape' && !indexSrc.includes('<OrientationProvider value="landscape">')) {
    issues.push('横版片子的 index.tsx 被改动了（缺少 OrientationProvider）：不要改 index.tsx，用 film new --landscape 重建');
  }
  if (expect !== undefined) {
    if (!isFilmOrientation(expect)) issues.push('--expect 只能是 landscape 或 portrait');
    else if (expect !== orientation) issues.push(`要${orientationLabel(expect)}，但这个片子目录是${orientationLabel(orientation)}：用 film new${expect === 'landscape' ? ' --landscape' : ''} 重建`);
  }
  return { orientation, issues };
}
```

- [ ] **Step 6: `commands/film.ts`**

- `film new`：`usage: 'mp film new <项目> [--landscape]'`；`run` 末行改为 `return scaffoldFilm(bundle, await nextFilmVersion(ctx.db, id), undefined, { orientation: p.flags.landscape ? 'landscape' : 'portrait' });`
- `film check`：`usage: 'mp film check <片子目录> [--expect landscape|portrait]'`；在 `const { data, shots } = await readFilm(filmDir);` 之后加：

```ts
      const orient = checkOrientation(data as { orientation?: unknown }, await fs.readFile(path.join(filmDir, 'index.tsx'), 'utf8').catch(() => ''), p.flags.expect);
      issues.push(...orient.issues);
```

  返回改为 `return { passed: true, orientation: orient.orientation };`，`format: (d) => \`film check 通过（${orientationLabel((d as { orientation: FilmOrientation }).orientation)}）\``。导入 `checkOrientation`、`orientationLabel`、`FilmOrientation`。

- [ ] **Step 7: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/film src/lib/cli/commands/film.ts tests/lib
git commit -m "feat(film): mp film new --landscape 建横版片子目录; film check 校验版式(--expect、横版 index 被改)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 登记记下版式，成片列表标横版

**Files:**
- Modify: `src/lib/film/register.ts`、`src/lib/project/view.ts`、`src/components/project/film-pane.tsx`
- Test: `tests/lib/film/register.test.ts`、`tests/lib/project/view.test.ts`、`tests/components/film-pane.test.tsx`（追加）

**Interfaces:**
- Consumes：`isFilmOrientation`、`FilmOrientation`（Task 2）
- Produces：版本元数据 `meta.orientation: FilmOrientation`；`FilmView.orientation: FilmOrientation`

- [ ] **Step 1: 写失败测试**

`register.test.ts` 追加：

```ts
  it('records the film orientation (old films count as portrait)', async () => {
    const { dir } = await filmDir();
    const data = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
    await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify({ ...data, orientation: 'landscape' }));
    const { db, files } = createFakeDb({ project: { stage: 'recorded' } });
    await registerFilm(db, dir, '横版首版');
    expect(files.find((x) => x.kind === 'final_mp4')!.meta).toMatchObject({ orientation: 'landscape' });
    const old = await filmDir();
    const second = createFakeDb({ project: { stage: 'recorded' } });
    await registerFilm(second.db, old.dir, '竖版');
    expect(second.files.find((x) => x.kind === 'final_mp4')!.meta).toMatchObject({ orientation: 'portrait' });
  });
```

`view.test.ts` 追加（`describe('material / film views')` 内）：

```ts
  it('exposes the film orientation, portrait when not recorded', () => {
    const base = { id: 'ff', path: '/x/f.mp4', createdAt: new Date('2026-10-04T00:00:00Z') };
    expect(toFilmView('p1', { ...base, meta: { filmVersion: 4, orientation: 'landscape' } }, []).orientation).toBe('landscape');
    expect(toFilmView('p1', { ...base, meta: { filmVersion: 1 } }, []).orientation).toBe('portrait');
  });
```

`film-pane.test.tsx` 追加：

```tsx
  it('marks landscape films and plays them full width', () => {
    const films = [
      { id: 'f4', version: 4, url: '/f4', createdAt: '2026-10-04T02:00:00Z', summary: '录屏版', usage: [], orientation: 'landscape' as const },
      { id: 'f3', version: 3, url: '/f3', createdAt: '2026-10-04T01:00:00Z', summary: '口播版', usage: [], orientation: 'portrait' as const },
    ];
    const { container } = render(<FilmPane projectId="p1" materials={[]} films={films} onChanged={vi.fn()} />);
    expect(screen.getAllByText('横版')).toHaveLength(1);
    const videos = container.querySelectorAll('li.card video');
    expect(videos[0].className).toContain('w-full');
    expect(videos[1].className).toContain('max-h-[60vh]');
  });
```

（同文件已有的 `films` 测试数据补上 `orientation: 'portrait' as const`，类型检查需要。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film/register.test.ts tests/lib/project/view.test.ts tests/components/film-pane.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

`register.ts`：`data` 的类型加 `orientation?: unknown`；`meta` 加 `orientation: isFilmOrientation(data.orientation) ? data.orientation : 'portrait'`。

`view.ts`：`FilmView` 加 `orientation: FilmOrientation;`；`toFilmView` 里 `m` 的类型加 `orientation?: unknown`，返回加 `orientation: m.orientation === 'landscape' ? 'landscape' : 'portrait',`。

`film-pane.tsx` 成片卡片：版本标题 `<b>{\`成片 v${f.version}\`}</b>` 后加 `{f.orientation === 'landscape' && <span className="chip">横版</span>}`；`<video src={f.url} controls className="mb-2 max-h-[60vh] rounded bg-black" />` 改为 `<video src={f.url} controls className={cn('mb-2 rounded bg-black', f.orientation === 'landscape' ? 'w-full' : 'max-h-[60vh]')} />`。

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/film/register.ts src/lib/project/view.ts src/components/project/film-pane.tsx tests
git commit -m "feat(film): 登记记下版式, 成片列表标「横版」并全宽播放

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 出片助手选横版

**Files:**
- Modify: `prisma/schema.prisma`、`src/lib/film-session/args.ts`、`src/lib/film-session/runner.ts`、`src/app/api/projects/[id]/film-session/route.ts`、`src/components/project/film-assistant.tsx`
- Test: `tests/lib/film-session/args.test.ts`、`tests/lib/film-session/runner.test.ts`、`tests/components/film-assistant.test.tsx`（追加）

**Interfaces:**
- Consumes：`FilmOrientation`（Task 2）
- Produces：
  - `firstMessage(i: { ...; orientation?: FilmOrientation })`
  - `startFilm(db, deps, i: { ...; orientation?: FilmOrientation })`：新出用 `i.orientation`（默认竖版）；改片读 `<deps.cwd>/<baseFilmDir>/data.json` 的 `orientation`
  - `FilmSession.orientation String @default("portrait")`
  - 接口 `start` 接受 `orientation`

- [ ] **Step 1: 写失败测试**

`args.test.ts` 追加：

```ts
  it('asks for a landscape film with the right commands', () => {
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', note: '多放录屏', orientation: 'landscape' })).toBe(
      '给项目 p1（U盘）出一版横版成片（画面 1920×1080）。用 `npm run -s mp -- film new p1 --landscape` 建片子目录，检查时用 `npm run -s mp -- film check <片子目录> --expect landscape`。要求：多放录屏',
    );
    expect(firstMessage({ kind: 'revise', projectId: 'p1', title: 'U盘', baseFilmDir: 'remotion/films/p1-v4', baseVersion: 4, note: '录屏放大', orientation: 'landscape' })).toBe(
      '改项目 p1（U盘）的成片：基于 v4（remotion/films/p1-v4）出新的一版横版（画面 1920×1080）。用 `npm run -s mp -- film new p1 --landscape` 建片子目录，检查时用 `npm run -s mp -- film check <片子目录> --expect landscape`。修改意见：录屏放大',
    );
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', orientation: 'portrait' })).toBe('给项目 p1（U盘）出一版成片。');
  });
```

`runner.test.ts` 追加：

```ts
  it('starts a landscape film and records the orientation', async () => {
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus', orientation: 'landscape' });
    expect(s.orientation).toBe('landscape');
    expect((await deps.readLines(s.logPath))[0]).toContain('横版成片');
    await settle(db, deps, s.id);
  });
  it('revise follows the base version orientation', async () => {
    const { db } = fakeDb();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cwd-'));
    fs.mkdirSync(path.join(cwd, 'remotion/films/p1-v4'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'remotion/films/p1-v4/data.json'), JSON.stringify({ orientation: 'landscape' }));
    const deps = realDeps({ cwd });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'revise', baseVersion: 4, note: 'x', model: 'opus', orientation: 'portrait' });
    expect(s.orientation).toBe('landscape');
    expect((await deps.readLines(s.logPath))[0]).toContain('横版');
    await settle(db, deps, s.id);
  });
```

（runner 测试的 fake db `create` 默认值里加 `orientation: 'portrait'`。）

`film-assistant.test.tsx` 追加：

```tsx
  it('starts a landscape film when 横版 is picked', async () => {
    const f = stub(data());
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('出一版')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '横版' }));
    expect(screen.getByRole('button', { name: '横版' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('出一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'new', orientation: 'landscape' }]));
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film-session tests/components/film-assistant.test.tsx`
Expected: FAIL。

- [ ] **Step 3: schema**

`model FilmSession` 加：

```prisma
  /// portrait | landscape(新出按选择, 改片沿用基础版本)
  orientation     String    @default("portrait")
```

Run: `npx prisma db push` → in sync。（改了 schema：真机验收前重启 dev。）

- [ ] **Step 4: `args.ts` 的 `firstMessage`**

```ts
export function firstMessage(i: { kind: 'new' | 'revise'; projectId: string; title: string; baseFilmDir?: string; baseVersion?: number; note?: string; orientation?: FilmOrientation }): string {
  const note = i.note?.trim();
  const land = i.orientation === 'landscape';
  const how = land ? `（画面 1920×1080）。用 \`npm run -s mp -- film new ${i.projectId} --landscape\` 建片子目录，检查时用 \`npm run -s mp -- film check <片子目录> --expect landscape\`。` : '。';
  if (i.kind === 'new') return `给项目 ${i.projectId}（${i.title}）出一版${land ? '横版' : ''}成片${how}${note ? `要求：${note}` : ''}`;
  return `改项目 ${i.projectId}（${i.title}）的成片：基于 v${i.baseVersion}（${i.baseFilmDir}）出新的一版${land ? '横版' : ''}${how}${note ? `修改意见：${note}` : ''}`;
}
```

导入 `import type { FilmOrientation } from '@/lib/film/orientation';`。（竖版两种消息与现有测试逐字一致。）

- [ ] **Step 5: `runner.ts` 的 `startFilm`**

参数加 `orientation?: FilmOrientation`；在算出 `baseFilmDir` 之后：

```ts
  // 改片沿用基础版本的版式(读它的 data.json, 没写 = 竖版); 新出按选择
  let orientation: FilmOrientation = i.orientation === 'landscape' ? 'landscape' : 'portrait';
  if (baseFilmDir) {
    const raw = (await deps.readLines(path.join(deps.cwd, baseFilmDir, 'data.json'))).join('\n');
    try {
      orientation = (JSON.parse(raw) as { orientation?: unknown }).orientation === 'landscape' ? 'landscape' : 'portrait';
    } catch {
      orientation = 'portrait';
    }
  }
```

`create` 的 `data` 加 `orientation`；`firstMessage({...})` 加 `orientation`。

- [ ] **Step 6: 接口与页面**

`route.ts` 的 `POST`：body 类型加 `orientation?: string`；`startFilm` 参数加 `orientation: b.orientation === 'landscape' ? 'landscape' : 'portrait'`。

`film-assistant.tsx`：加 `const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');`；在「出一版」按钮前加：

```tsx
              <div className="flex rounded-[var(--r-md)] bg-[var(--bg-inset)] p-0.5 text-xs" role="group" aria-label="版式">
                {(['portrait', 'landscape'] as const).map((o) => (
                  <button key={o} aria-pressed={orient === o} className={cn('rounded-[var(--r-sm)] px-2 py-1', orient === o && 'bg-[var(--bg-surface)] font-semibold shadow-sm')} onClick={() => setOrient(o)}>
                    {o === 'landscape' ? '横版' : '竖版'}
                  </button>
                ))}
              </div>
```

「出一版」的 body 改为 `{ action: 'start', kind: 'new', ...(orient === 'landscape' ? { orientation: 'landscape' } : {}), ...(note.trim() ? { note: note.trim() } : {}) }`（竖版请求与现在逐字一致）。「改这一版」不变（沿用基础版本）。

- [ ] **Step 7: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add prisma/schema.prisma src/lib/film-session src/app/api src/components/project tests
git commit -m "feat(film-session): 出片助手可选横版; 改片沿用基础版本的版式; 横版首轮消息带 --landscape 与 --expect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: skill、README 与验收

**Files:**
- Modify: `.claude/skills/produce-film/SKILL.md`、`README.md`、`docs/superpowers/specs/2026-10-04-landscape-film-design.md`（追加实测）

- [ ] **Step 1: produce-film 加「横版」一节**（放在「流程」之前）

```markdown
## 横版

`data.json` 里 `orientation` 为 `landscape` 时是横版(1920×1080): 内容区 1360×765(正好 16:9), 右栏上面人物小窗、下面段落标题, 字幕在内容区下方; 遮挡区见 `remotion/kit/tokens.ts` 的 `LANDSCAPE_OVERLAYS`。
- 录屏和操作演示素材优先整块铺满内容区(16:9 录屏等比铺满不裁); 卡片可以横向并排、字可以多一些。
- 不要改 `index.tsx`(版式由它决定, 改了 film check 不通过)。
- 被要求了版式时, 检查用 `npm run -s mp -- film check <片子目录> --expect landscape`。
- 其余流程与竖版完全相同。
```

- [ ] **Step 2: README**：「③ 成片」条目在"出片模型在设置页"前加："出片助手里可选竖版 / 横版（横版 1920×1080，内容区 1360×765 适合放录屏与操作演示；改片沿用原版本的版式）；命令行 `mp film new <项目> --landscape`。"

- [ ] **Step 3: 本地横版渲染检查（不用额度）**

```bash
npx tsx -e "import('./src/lib/film/bundle').then(async ({ buildFilmBundle }) => { const { prisma } = await import('./src/lib/prisma'); const { scaffoldFilm } = await import('./src/lib/film/scaffold'); console.log(await scaffoldFilm(await buildFilmBundle(prisma, 'cmujxgbz6000eg417ngfzoolz'), 999, undefined, { orientation: 'landscape' })); await prisma.\$disconnect(); })"
npm run -s mp -- film check remotion/films/cmujxgbz6000eg417ngfzoolz-v999 --expect landscape
npm run -s mp -- film render remotion/films/cmujxgbz6000eg417ngfzoolz-v999 --stills
```

Expected: 建出 v999（检查用的临时目录，版本号远离真实版本）；`film check 通过（横版）`；stills 为 1920×1080。取一张 still 叠遮挡区：`ffmpeg -i <still> -vf "drawbox=x=0:y=0:w=1920:h=120:color=red@0.35:t=fill,drawbox=x=0:y=1005:w=1920:h=75:color=red@0.35:t=fill,drawbox=x=0:y=0:w=96:h=1080:color=red@0.35:t=fill,drawbox=x=1824:y=0:w=96:h=1080:color=red@0.35:t=fill" <out>.png`，看小窗、段落标题、内容区、字幕都在红区外。看完 `rm -r remotion/films/cmujxgbz6000eg417ngfzoolz-v999`。

- [ ] **Step 4: 真机验收（会用订阅额度；dev 在用户终端里起）**

1. 重启 dev（schema 改过）。
2. 「U盘干到品类第一（验收）」→ 成片 → 选「横版」→「出一版」：进度里出现 `建片子目录 v4`、`检查：通过` → 停在镜头表 →「可以，继续」→ 停在「等你确认成片」，预览为横版。
3. 抽帧叠遮挡区检查；结果发给用户，由用户决定是否登记 v4。
4. 实测写入 spec 末尾。

- [ ] **Step 5: 收尾提交**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add .claude/skills/produce-film/SKILL.md README.md docs/superpowers/specs/2026-10-04-landscape-film-design.md
git commit -m "docs: produce-film 加横版一节, README 补横版, spec 记录实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
