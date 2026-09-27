# 阶段 4 实施计划：Remotion 竖屏口播成片（Claude Code 创作）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Code 能读取项目的稿子、转写、口播原片与素材，用固定画框（人物右上角小窗 + 内容区 + 字幕）创作一条 1080×1920 的 Remotion 成片，经自动检查与看关键帧后渲染，并登记回项目的「③ 成片」标签。

**Architecture:** `remotion/` 是独立子工程（自己的 `package.json` / `node_modules`，React 19，Remotion 4.0.399），只被命令行调用渲染，主项目从不 import 它。组件库在 `remotion/kit/`，每条片子的源码在 `remotion/films/<项目id>-v<N>/`（gitignore）。主项目新增 `mp` 命令行（导出资料包、搭片子骨架、检查、渲染、登记），检查规则是可单测的纯函数。网页端新增素材上传与「③ 成片」标签，只播放 mp4。

**Tech Stack:** Remotion 4.0.399（`@remotion/bundler` + `@remotion/renderer`）、React 19（仅 remotion/）、Next.js 14、Prisma 5、zod、tsx、vitest。

**Spec:** `docs/superpowers/specs/2026-09-28-film-production-design.md`

## Global Constraints

- 画布 1080×1920、30fps；分区数值以 spec §4.1 为准：小窗 top 70 / right 60 / 350×470；标题区 x 60–650、y 70–540；内容区 x 60–1020、y 560–1340（`overflow: hidden`）；字幕带 y 1380–1500。
- 风格 C 色板：底 `#F6F7F9`、格线 `#E3E7EE`、墨 `#0F172A`、次要 `#64748B`、强调钴蓝 `#2563EB`、浅蓝 `#EEF2FF`、深蓝字 `#1E3A8A`、荧光笔 `#FDE68A`、卡片白 `#FFFFFF`；字体苹方 + SF Mono，不联网下载字体。
- 主项目绝不 import `remotion/` 下的任何文件；根 `tsconfig.json` 排除 `remotion`。渲染只能经 `mp film render` 调用 `remotion/scripts/render.ts`。
- 画面上的所有文字放在每条片子的 `copy.ts` 里（`export const COPY`）；`film check` 只在这里查数字。
- 镜头：首尾相接（容差 0.05 秒），覆盖 0 到口播原片时长；单镜 1–12 秒；素材加速 ≤ 2 倍；视频素材截取区间在素材时长内，且截取时长 ÷ 加速倍数 ≤ 镜头时长 + 0.05 秒。
- 画面数字必须能在稿子或转写里找到（阿拉伯数字或其简单中文写法）。
- 成片声音 = 口播原片原声；素材一律静音。
- 阶段只前进：登记成片时 `draft` / `scripted` / `recorded` → `final`。
- 素材上传只接受 `png` / `jpg` / `jpeg` / `webp` / `mp4` / `mov` / `m4v`，流式写盘。
- 继承既有约束：不在 dev 运行时跑 `npm run build`；改 schema 需重启（本阶段不改 schema）。

## Review Focus

1. **素材文件被删除或移动后再渲染**——应在 `film check` 阶段报"素材文件不存在：xxx"，而不是渲染到一半崩。→ Task 5 测试 `reports a missing material file`。
2. **转写里的数字是中文写法**（"五十多岁"、"六千多单"），画面写成 `50+`、`6000`——不应被误判为编造。→ Task 5 测试 `accepts numbers that appear in Chinese form`。
3. **同一项目重复执行 `film new`**（上一版未登记）——不能覆盖已有片子目录。→ Task 4 测试 `skips versions whose directory already exists`。
4. **登记时 mp4 不存在或为空**——应中文报错并不写数据库。→ Task 4 测试 `refuses to register when the mp4 is missing or empty`。
5. **素材说明含中文与换行**（经 HTTP 头传递）——应完整保存。→ Task 6 测试 `decodes a multi-line Chinese note from the header`。

---

## 文件结构

```
tsconfig.json                          exclude 加 remotion
.gitignore                             + remotion/node_modules、remotion/films/*、!remotion/films/.gitkeep
package.json                           + "mp": "tsx scripts/mp.ts"
remotion/package.json, tsconfig.json   独立子工程
remotion/scripts/render.ts             bundle → selectComposition → renderStill / renderMedia
remotion/kit/tokens.ts                 画布、色板、字体、分区常量
remotion/kit/motion/anim.ts            复用 v1-final 的 video-talkcraft 动效纯函数(含 LICENSE、README)
remotion/kit/Frame.tsx                 背景方格 + 标题区 + 内容区 + 小窗 + 字幕
remotion/kit/Captions.tsx              逐句字幕(荧光笔高亮)
remotion/kit/Shot.tsx                  按秒放置的镜头(Sequence + 0.3 秒入场)
remotion/kit/cards.tsx                 Note / Kicker / Stat / StepList / Marker / Compare / Quote / Arrow
remotion/kit/media.tsx                 WindowFrame(浏览器窗/手机外框) + MediaIn(图片/视频, 截取/加速/静音)
remotion/kit/index.ts                  统一导出
remotion/films/.gitkeep
src/lib/film/shots.ts                  shots.json 的 zod schema
src/lib/film/check.ts                  镜头覆盖 / 素材 / 数字 三类检查(纯函数)
src/lib/film/bundle.ts                 导出资料包 buildFilmBundle
src/lib/film/scaffold.ts               nextFilmVersion + scaffoldFilm(建目录、data.json、硬链接素材、模板文件)
src/lib/film/register.ts               registerFilm(移 mp4、建 final_mp4、推进阶段、发通知)
src/lib/film/materials.ts              素材扩展名、创建/改说明/删除
src/lib/project/view.ts                + MaterialView / FilmView
src/lib/project/load.ts                + materials、films
scripts/mp.ts                          命令行入口
src/app/api/projects/[id]/materials/route.ts            PUT 上传素材
src/app/api/projects/[id]/materials/[fileId]/route.ts   PATCH 说明 / DELETE
src/app/api/projects/[id]/files/[fileId]/route.ts       + 图片类型
src/components/project/film-pane.tsx   ③ 成片标签
src/components/project/project-workspace.tsx  + 第三个标签
src/lib/agent/context.ts、src/app/page.tsx      + final 阶段文案
.claude/skills/produce-film/SKILL.md  出片流程
删除: src/lib/overlay-studio/、src/lib/llm/prompts/overlay-arrange.ts、tests/lib/overlay-studio/
tests: tests/lib/film/*.test.ts, tests/components/film-pane.test.tsx, tests/helpers/fake-db.ts(扩展)
```

---

### Task 1: 移除 Overlay Studio 集成

**Files:**
- Delete: `src/lib/overlay-studio/`、`src/lib/llm/prompts/overlay-arrange.ts`、`tests/lib/overlay-studio/`

- [ ] **Step 1: 删除并确认无引用**

```bash
git rm -r -q src/lib/overlay-studio src/lib/llm/prompts/overlay-arrange.ts tests/lib/overlay-studio
git grep -nE "overlay-studio|overlay-arrange|OverlayArrangement|runOverlayLint" -- src tests scripts
```
Expected: grep 无输出。

- [ ] **Step 2: 检查与提交**

Run: `npm run typecheck && npm test`
Expected: 0 错误；全绿（测试数比 138 少 overlay-studio 那几条）。

```bash
git commit -m "chore(film): 移除 Overlay Studio 集成(阶段 4 改走 Remotion)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remotion 子工程、渲染脚本、实测渲染耗时

**Files:**
- Create: `remotion/package.json`、`remotion/tsconfig.json`、`remotion/scripts/render.ts`、`remotion/kit/tokens.ts`、`remotion/films/.gitkeep`
- Modify: `tsconfig.json`（exclude）、`.gitignore`

**Interfaces:**
- Produces: 渲染命令 `node_modules/.bin/tsx remotion/scripts/render.ts <filmDir> --stills <秒,秒,...>` → 每个秒数一张 `<filmDir>/stills/<秒>.png`；`... render.ts <filmDir> --out <mp4>` → 成片。片子目录约定：`index.tsx`（`registerRoot`，合成 id 固定 `Film`）+ `public/`。
- Produces（`tokens.ts`）：`W=1080`、`H=1920`、`FPS=30`、`C`（色板对象）、`FONT`、`MONO`、`ZONE`（`pip`、`title`、`content`、`captions` 四个矩形）。

- [ ] **Step 1: 子工程配置**

`remotion/package.json`:

```json
{
  "name": "mediapilot-remotion",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@remotion/bundler": "4.0.399",
    "@remotion/renderer": "4.0.399",
    "remotion": "4.0.399",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.6.3"
  }
}
```

`remotion/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["kit", "films", "scripts"]
}
```

根 `tsconfig.json` 的 `"exclude"` 改为 `["node_modules", "vendor", "tools", "remotion"]`。

`.gitignore` 追加：

```
# 阶段 4: Remotion 子工程依赖与每条片子的源码/产物(源码随项目走, 不入库)
/remotion/node_modules/
/remotion/films/*
!/remotion/films/.gitkeep
```

`remotion/films/.gitkeep`：空文件。

- [ ] **Step 2: 安装依赖**

Run: `cd remotion && npm install && cd ..`
Expected: 安装成功；`ls remotion/node_modules/@remotion` 含 `bundler`、`renderer`。

- [ ] **Step 3: `remotion/kit/tokens.ts`**

```ts
/** 风格 C · 极客手账。所有数值以 spec §4.1 为准, 改这里即改全部片子。 */
export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bg: '#F6F7F9',
  grid: '#E3E7EE',
  ink: '#0F172A',
  muted: '#64748B',
  accent: '#2563EB',
  accentSoft: '#EEF2FF',
  accentInk: '#1E3A8A',
  marker: '#FDE68A',
  card: '#FFFFFF',
} as const;

export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
export const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

type Rect = { left: number; top: number; width: number; height: number };
export const ZONE: { pip: Rect; title: Rect; content: Rect; captions: Rect } = {
  pip: { left: W - 60 - 350, top: 70, width: 350, height: 470 },
  title: { left: 60, top: 70, width: 590, height: 470 },
  content: { left: 60, top: 560, width: 960, height: 780 },
  captions: { left: 60, top: 1380, width: 960, height: 120 },
};
```

- [ ] **Step 4: `remotion/scripts/render.ts`**

```ts
import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

/**
 * 用法:
 *   render.ts <filmDir> --stills 1.5,4.2,9   每个秒数渲一张 <filmDir>/stills/<秒>.png
 *   render.ts <filmDir> --out <mp4>          渲整片
 * 片子目录必须有 index.tsx(registerRoot, 合成 id = Film) 与 public/。
 */
async function main() {
  const [filmDirArg, flag, value] = process.argv.slice(2);
  if (!filmDirArg || !flag || !value) throw new Error('用法: render.ts <filmDir> --stills <秒,...> | --out <mp4>');
  const filmDir = path.resolve(filmDirArg);
  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: path.join(filmDir, 'index.tsx'), publicDir: path.join(filmDir, 'public') });
  const composition = await selectComposition({ serveUrl, id: 'Film' });

  if (flag === '--stills') {
    const dir = path.join(filmDir, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of value.split(',').map(Number)) {
      const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(s * composition.fps)));
      const output = path.join(dir, `${s}.png`);
      await renderStill({ composition, serveUrl, output, frame });
      console.log(`still ${output}`);
    }
  } else if (flag === '--out') {
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 18,
      outputLocation: path.resolve(value),
      onProgress: ({ progress }) => {
        const p = Math.floor(progress * 10);
        if (p !== last) {
          last = p;
          console.log(`progress ${p * 10}%`);
        }
      },
    });
    console.log(`out ${path.resolve(value)}`);
  } else {
    throw new Error(`未知参数 ${flag}`);
  }
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
```

- [ ] **Step 5: 实测渲染耗时（临时片子，不入库）**

建 `remotion/films/_probe/`（被 gitignore）：`public/raw.mov` 硬链接到 `~/mediapilot-archive/video-productions/51525511-00d/source.mov`（`ln`），以及：

`remotion/films/_probe/index.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, Composition, OffthreadVideo, registerRoot, staticFile } from 'remotion';
import { C, FPS, H, W, ZONE } from '../../kit/tokens';

const Probe: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <div style={{ position: 'absolute', ...ZONE.pip, borderRadius: 36, overflow: 'hidden', border: '12px solid #fff' }}>
      <OffthreadVideo src={staticFile('raw.mov')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 20%' }} />
    </div>
    <div style={{ position: 'absolute', ...ZONE.content, background: C.card, borderRadius: 36 }} />
  </AbsoluteFill>
);

registerRoot(() => <Composition id="Film" component={Probe} durationInFrames={Math.ceil(79.23 * FPS)} fps={FPS} width={W} height={H} />);
```

Run:
```bash
cd remotion && npx tsc --noEmit && cd ..
node_modules/.bin/tsx remotion/scripts/render.ts remotion/films/_probe --stills 5
node_modules/.bin/tsx remotion/scripts/render.ts remotion/films/_probe --out remotion/films/_probe/out.mp4 | tail -3
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact remotion/films/_probe/out.mp4
```
Expected: 类型检查通过；首次渲染会下载 Chrome Headless Shell（网络）；静帧 `5.png` 存在（用 Read 看：右上角是人像、下方白卡）；整片渲染完成，打印 `elapsed <秒>`；ffprobe 显示 h264 1080×1920 + aac、时长 ≈ 79.2。**把 elapsed 记入 ledger**（spec §9 待实测）。若整片 > 10 分钟，停下报告（影响修改体验，需讨论降配预览）。

- [ ] **Step 6: 清理探测片子，提交**

```bash
rm -rf remotion/films/_probe
npm run typecheck && npm test
git add tsconfig.json .gitignore remotion/package.json remotion/package-lock.json remotion/tsconfig.json remotion/scripts remotion/kit/tokens.ts remotion/films/.gitkeep
git commit -m "feat(film): Remotion 子工程 + 渲染脚本(静帧/整片) + 风格 C 画布常量

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 画框与组件库

**Files:**
- Create: `remotion/kit/motion/anim.ts`（取自 v1-final）、`remotion/kit/motion/LICENSE-video-talkcraft`、`remotion/kit/motion/README.md`、`remotion/kit/Frame.tsx`、`remotion/kit/Captions.tsx`、`remotion/kit/Shot.tsx`、`remotion/kit/cards.tsx`、`remotion/kit/media.tsx`、`remotion/kit/index.ts`

**Interfaces:**
- Consumes: `tokens.ts`（Task 2）。
- Produces（`kit/index.ts` 统一导出）：
  - `type CaptionLine = { startSec: number; endSec: number; text: string }`
  - `Frame({ video: string; pipFocus?: string; captions: CaptionLine[]; highlights?: string[]; title?: ReactNode; children: ReactNode })`
  - `Shot({ from: number; to: number; enter?: 'fade' | 'up' | 'left'; children })`（秒）
  - `Note`、`Kicker`、`Stat({ value: string; label?: string; at?: number })`、`StepList({ items: string[]; at?: number })`、`Marker({ children; at?: number })`、`Compare({ left: {title; lines: string[]}; right: {…}; at? })`、`Quote({ text; source? })`、`Arrow({ at? })`
  - `WindowFrame({ kind: 'browser' | 'phone'; title?: string; children })`、`MediaIn({ file: string; type: 'image' | 'video'; clipFromSec?: number; speed?: number; fit?: 'contain' | 'cover' })`
  - 以及 `anim.ts` 原有导出（`fadeUp`、`smashIn`、`slideIn`、`staggerIn`、`sweepHighlight`、`countTo` 等）。

- [ ] **Step 1: 取回 v1 动效纯函数与授权文件**

```bash
mkdir -p remotion/kit/motion
git show v1-final:remotion/src/motion/anim.ts > remotion/kit/motion/anim.ts
git show v1-final:remotion/src/motion/LICENSE-video-talkcraft > remotion/kit/motion/LICENSE-video-talkcraft
git show v1-final:remotion/src/motion/README.md > remotion/kit/motion/README.md
cd remotion && npx tsc --noEmit; cd ..
```
Expected: 类型检查通过（`anim.ts` 只依赖 `remotion` 与 `react` 类型）。若 `anim.ts` import 了 v1 其他文件（如 `./lib`），只取回被用到的纯函数所在文件，并在 README 顶部追加一行「2026-09-28 迁入 remotion/kit/motion，只保留 anim.ts」。

- [ ] **Step 2: `remotion/kit/Captions.tsx`**

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, ZONE } from './tokens';

export type CaptionLine = { startSec: number; endSec: number; text: string };

/** 把 text 里命中 highlights 的片段包成荧光笔 */
function mark(text: string, highlights: string[]): React.ReactNode[] {
  if (highlights.length === 0) return [text];
  const re = new RegExp(`(${highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) =>
    highlights.includes(part) ? (
      <span key={i} style={{ color: C.marker }}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export const Captions: React.FC<{ lines: CaptionLine[]; highlights?: string[] }> = ({ lines, highlights = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const line = lines.find((l) => t >= l.startSec && t < l.endSec);
  if (!line) return null;
  return (
    <div style={{ position: 'absolute', ...ZONE.captions, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          maxWidth: ZONE.captions.width,
          background: C.ink,
          color: '#fff',
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.3,
          padding: '14px 30px',
          borderRadius: 22,
          textAlign: 'center',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {mark(line.text, highlights)}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: `remotion/kit/Frame.tsx`**

```tsx
import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { C, ZONE } from './tokens';
import { Captions, type CaptionLine } from './Captions';

const GRID = 70;

/**
 * 固定画框: 方格纸底 + 左上标题区 + 内容区(overflow hidden, 内容不可能压到小窗与字幕)
 * + 右上角人物小窗(口播原片, 带原声) + 底部字幕。每条片子只往 children(内容区)里放东西。
 */
export const Frame: React.FC<{
  video: string;
  pipFocus?: string;
  captions: CaptionLine[];
  highlights?: string[];
  title?: React.ReactNode;
  children: React.ReactNode;
}> = ({ video, pipFocus = '50% 20%', captions, highlights, title, children }) => (
  <AbsoluteFill
    style={{
      background: C.bg,
      backgroundImage: `linear-gradient(${C.grid} 2px, transparent 2px), linear-gradient(90deg, ${C.grid} 2px, transparent 2px)`,
      backgroundSize: `${GRID}px ${GRID}px`,
    }}
  >
    {title && (
      <div style={{ position: 'absolute', ...ZONE.title, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{title}</div>
    )}
    <div style={{ position: 'absolute', ...ZONE.content, overflow: 'hidden' }}>{children}</div>
    <div
      style={{
        position: 'absolute',
        ...ZONE.pip,
        borderRadius: 36,
        border: '12px solid #fff',
        boxShadow: '0 20px 60px rgba(15,23,42,0.18)',
        overflow: 'hidden',
        background: C.ink,
      }}
    >
      <OffthreadVideo src={staticFile(video)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pipFocus }} />
    </div>
    <Captions lines={captions} highlights={highlights} />
  </AbsoluteFill>
);
```

- [ ] **Step 4: `remotion/kit/Shot.tsx`**

```tsx
import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** 按秒放置一个镜头, 入场 0.3 秒(淡入 / 上移 / 左移) */
export const Shot: React.FC<{ from: number; to: number; enter?: 'fade' | 'up' | 'left'; children: React.ReactNode }> = ({
  from,
  to,
  enter = 'up',
  children,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.round(from * fps)} durationInFrames={Math.max(1, Math.round((to - from) * fps))} layout="none">
      <Enter kind={enter}>{children}</Enter>
    </Sequence>
  );
};

const Enter: React.FC<{ kind: 'fade' | 'up' | 'left'; children: React.ReactNode }> = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, 0.3 * fps], [0, 1], { extrapolateRight: 'clamp' });
  const offset = (1 - p) * 60;
  const transform = kind === 'up' ? `translateY(${offset}px)` : kind === 'left' ? `translateX(${offset}px)` : undefined;
  return <AbsoluteFill style={{ opacity: p, transform }}>{children}</AbsoluteFill>;
};
```

- [ ] **Step 5: `remotion/kit/cards.tsx`**

```tsx
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, MONO } from './tokens';

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { t: frame / fps, fps, frame };
};
const ease = (t: number, at: number, dur = 0.35) => interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/** 白色便签卡: 大部分内容的容器 */
export const Note: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.card, borderRadius: 36, boxShadow: '0 24px 60px rgba(15,23,42,0.10)', padding: '48px 52px', fontFamily: FONT, color: C.ink, ...style }}>
    {children}
  </div>
);

/** `// xxx` 等宽标签 */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.accent }) => (
  <div style={{ fontFamily: MONO, fontSize: 34, color, letterSpacing: 1, marginBottom: 20 }}>{'// '}{children}</div>
);

/** 大数字 + 说明; value 里的数字部分从 0 滚到目标值(保留原小数位与前后缀) */
export const Stat: React.FC<{ value: string; label?: string; at?: number }> = ({ value, label, at = 0.2 }) => {
  const { t } = useT();
  const m = /^(\D*)(\d+(?:\.\d+)?)(.*)$/.exec(value);
  const p = ease(t, at, 0.8);
  let shown = value;
  if (m) {
    const decimals = (m[2].split('.')[1] ?? '').length;
    shown = `${m[1]}${(Number(m[2]) * p).toFixed(decimals)}${m[3]}`;
  }
  return (
    <div style={{ fontFamily: FONT, color: C.ink }}>
      <div style={{ fontSize: 200, fontWeight: 800, lineHeight: 1, color: C.accent, letterSpacing: -4 }}>{shown}</div>
      {label && <div style={{ fontSize: 56, fontWeight: 700, marginTop: 16, opacity: ease(t, at + 0.4) }}>{label}</div>}
    </div>
  );
};

/** 01 02 03 编号条, 逐条弹入 */
export const StepList: React.FC<{ items: string[]; at?: number; step?: number }> = ({ items, at = 0.2, step = 0.35 }) => {
  const { t } = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {items.map((item, i) => {
        const p = ease(t, at + i * step);
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 24,
              alignItems: 'baseline',
              background: C.accentSoft,
              color: C.accentInk,
              borderRadius: 18,
              padding: '26px 30px',
              fontFamily: MONO,
              fontSize: 44,
              opacity: p,
              transform: `translateX(${(1 - p) * 40}px)`,
            }}
          >
            <b style={{ color: C.accent }}>{String(i + 1).padStart(2, '0')}</b>
            <span style={{ fontFamily: FONT, fontWeight: 600 }}>{item}</span>
          </div>
        );
      })}
    </div>
  );
};

/** 荧光笔: 从左到右划过 */
export const Marker: React.FC<{ children: React.ReactNode; at?: number }> = ({ children, at = 0.4 }) => {
  const { t } = useT();
  const p = ease(t, at, 0.4);
  return (
    <span style={{ backgroundImage: `linear-gradient(transparent 58%, ${C.marker} 58%)`, backgroundSize: `${p * 100}% 100%`, backgroundRepeat: 'no-repeat' }}>
      {children}
    </span>
  );
};

/** 左右对比 */
export const Compare: React.FC<{ left: { title: string; lines: string[] }; right: { title: string; lines: string[] }; at?: number }> = ({ left, right, at = 0.2 }) => {
  const { t } = useT();
  const col = (side: { title: string; lines: string[] }, delay: number, strong: boolean) => (
    <div style={{ flex: 1, background: strong ? C.accent : C.card, color: strong ? '#fff' : C.ink, borderRadius: 30, padding: 40, opacity: ease(t, at + delay), boxShadow: '0 20px 50px rgba(15,23,42,0.10)' }}>
      <div style={{ fontFamily: MONO, fontSize: 32, opacity: 0.8, marginBottom: 18 }}>{side.title}</div>
      {side.lines.map((l, i) => (
        <div key={i} style={{ fontFamily: FONT, fontSize: 44, fontWeight: 700, lineHeight: 1.35 }}>{l}</div>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
      {col(left, 0, false)}
      {col(right, 0.3, true)}
    </div>
  );
};

/** 引用卡 */
export const Quote: React.FC<{ text: string; source?: string }> = ({ text, source }) => (
  <Note>
    <div style={{ fontSize: 120, lineHeight: 0.6, color: C.accent, fontFamily: 'Georgia, serif' }}>“</div>
    <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.4 }}>{text}</div>
    {source && <div style={{ fontFamily: MONO, fontSize: 30, color: C.muted, marginTop: 24 }}>{'— '}{source}</div>}
  </Note>
);

/** 向下的箭头(连接上下两块), 描画出现 */
export const Arrow: React.FC<{ at?: number }> = ({ at = 0.3 }) => {
  const { t } = useT();
  const p = ease(t, at, 0.3);
  return (
    <svg width="80" height="90" viewBox="0 0 80 90" style={{ display: 'block', margin: '12px auto' }}>
      <path d="M40 5 V70 M15 50 L40 80 L65 50" fill="none" stroke={C.accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  );
};
```

- [ ] **Step 6: `remotion/kit/media.tsx`**

```tsx
import React from 'react';
import { Img, OffthreadVideo, staticFile, useVideoConfig } from 'remotion';
import { C, MONO } from './tokens';

/** 浏览器窗 / 手机外框, 用来装录屏、截图、图片 */
export const WindowFrame: React.FC<{ kind: 'browser' | 'phone'; title?: string; children: React.ReactNode }> = ({ kind, title, children }) =>
  kind === 'browser' ? (
    <div style={{ background: C.card, borderRadius: 28, overflow: 'hidden', boxShadow: '0 24px 60px rgba(15,23,42,0.14)', border: `2px solid ${C.grid}` }}>
      <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px', background: '#EEF1F5' }}>
        {['#F87171', '#FBBF24', '#34D399'].map((c) => (
          <span key={c} style={{ width: 20, height: 20, borderRadius: 10, background: c }} />
        ))}
        {title && <span style={{ marginLeft: 16, fontFamily: MONO, fontSize: 26, color: C.muted }}>{title}</span>}
      </div>
      <div style={{ position: 'relative', background: '#000' }}>{children}</div>
    </div>
  ) : (
    <div style={{ width: 430, margin: '0 auto', borderRadius: 60, padding: 18, background: C.ink, boxShadow: '0 24px 60px rgba(15,23,42,0.25)' }}>
      <div style={{ borderRadius: 44, overflow: 'hidden', background: '#000' }}>{children}</div>
    </div>
  );

/**
 * 素材: 图片或视频(静音)。视频从 clipFromSec 开始, 按 speed 倍速播放(≤2, 由 film check 保证)。
 * 在 <Shot> 里使用时, 播放从镜头开始那一帧算起。
 */
export const MediaIn: React.FC<{
  file: string;
  type: 'image' | 'video';
  clipFromSec?: number;
  speed?: number;
  fit?: 'contain' | 'cover';
  height?: number;
}> = ({ file, type, clipFromSec = 0, speed = 1, fit = 'contain', height = 600 }) => {
  const { fps } = useVideoConfig();
  const style: React.CSSProperties = { width: '100%', height, objectFit: fit, display: 'block' };
  return type === 'image' ? (
    <Img src={staticFile(file)} style={style} />
  ) : (
    <OffthreadVideo src={staticFile(file)} muted startFrom={Math.round(clipFromSec * fps)} playbackRate={speed} style={style} />
  );
};
```

- [ ] **Step 7: `remotion/kit/index.ts`**

```ts
export * from './tokens';
export * from './Captions';
export * from './Frame';
export * from './Shot';
export * from './cards';
export * from './media';
export * from './motion/anim';
```

- [ ] **Step 8: 组件目检片子（临时，不入库）**

建 `remotion/films/_kit/`：`public/raw.mov` 硬链接到 U 盘原片、`public/shot.png`（`ffmpeg -ss 30 -i <原片> -frames:v 1 remotion/films/_kit/public/shot.png`）。

`remotion/films/_kit/index.tsx`:

```tsx
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Frame, Shot, Note, Kicker, Stat, StepList, Marker, Compare, Quote, Arrow, WindowFrame, MediaIn, FPS, W, H } from '../../kit';

const captions = [
  { startSec: 0, endSec: 4, text: '半年后干到类目第一' },
  { startSec: 4, endSec: 8, text: '就是这么一个笨办法' },
  { startSec: 8, endSec: 12, text: '最踏实的不是看见订单' },
  { startSec: 12, endSec: 16, text: '把录屏放进窗口里' },
];

const Kit: React.FC = () => (
  <Frame video="raw.mov" captions={captions} highlights={['类目第一', '笨办法']} title={<Kicker>半年后</Kicker>}>
    <Shot from={0} to={4}>
      <Note><Stat value="#1" label="抖音类目第一" /></Note>
    </Shot>
    <Shot from={4} to={8}>
      <Kicker>笨办法.md</Kicker>
      <StepList items={['找现成开源 AI 项目', '打包封装塞进 U 盘', '插上电脑，双击就用']} />
    </Shot>
    <Shot from={8} to={12} enter="fade">
      <Compare left={{ title: '以为', lines: ['看见订单'] }} right={{ title: '其实', lines: ['售后群里', '一句「成了」'] }} />
      <Arrow />
      <Quote text="又有一个不会用电脑的人，把 AI 用起来了" />
    </Shot>
    <Shot from={12} to={16} enter="left">
      <WindowFrame kind="browser" title="demo.mov"><MediaIn file="shot.png" type="image" /></WindowFrame>
      <div style={{ marginTop: 30, fontSize: 48 }}>普通人也能<Marker>双击就用</Marker></div>
    </Shot>
  </Frame>
);

registerRoot(() => <Composition id="Film" component={Kit} durationInFrames={16 * FPS} fps={FPS} width={W} height={H} />);
```

Run:
```bash
cd remotion && npx tsc --noEmit && cd ..
node_modules/.bin/tsx remotion/scripts/render.ts remotion/films/_kit --stills 2,6,10,14
```
Expected: 4 张静帧生成。**逐张 Read 查看**，对照 spec §4.1：人物在右上角小窗且脸完整；内容不压小窗、不压字幕；字幕在 y≈1380–1500、两行内；中文用苹方正常显示（不是方块/衬线回退）；数字卡、步骤条、对比卡、窗口框排版不溢出。不合格就调整对应组件的尺寸/间距再重渲，直到四张都合格；在 ledger 记录调整了什么。

- [ ] **Step 9: 清理并提交**

```bash
rm -rf remotion/films/_kit
cd remotion && npx tsc --noEmit && cd ..
git add remotion/kit
git commit -m "feat(film): 风格 C 画框与组件库(小窗/字幕/镜头/便签/数字/步骤/对比/引用/箭头/窗口框/素材)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 资料包、片子骨架、登记（主项目纯逻辑）

**Files:**
- Create: `src/lib/film/shots.ts`、`src/lib/film/bundle.ts`、`src/lib/film/scaffold.ts`、`src/lib/film/register.ts`
- Modify: `tests/helpers/fake-db.ts`（`projectFile.findMany/update/delete`）
- Test: `tests/lib/film/bundle.test.ts`、`tests/lib/film/scaffold.test.ts`、`tests/lib/film/register.test.ts`

**Interfaces:**
- Consumes: `loadCurrentTranscript`（阶段 3）、`ScriptSchema`、`projectDir`、`probeVideoDimensions`（`src/lib/video/ffmpeg.ts`）。
- Produces:
  - `shots.ts`：`ShotsFileSchema`，类型 `ShotsFile = { version: 1; shots: { id: string; fromSec: number; toSec: number; intent: string; material?: { id: string; clipFromSec?: number; clipToSec?: number; speed?: number } }[] }`
  - `bundle.ts`：`interface FilmBundle { project: { id; title; stage; targetSec }; script: Script | null; transcript: { startSec; endSec; text }[]; video: { path: string; ext: string; durationSec: number; width: number; height: number } | null; materials: { id: string; path: string; ext: string; mediaType: 'image' | 'video'; note: string; originalName: string; durationSec: number | null }[] }`；`buildFilmBundle(db, projectId, probe?: (p: string) => Promise<{ width: number; height: number }>): Promise<FilmBundle>`（无视频或无转写时抛中文错误）
  - `scaffold.ts`：`filmsRoot(): string`（`<cwd>/remotion/films`，可被 `FILMS_ROOT` 覆盖）；`nextFilmVersion(db, projectId, root?): Promise<number>`；`scaffoldFilm(bundle: FilmBundle, version: number, root?): Promise<string>`（返回片子目录）
  - `register.ts`：`registerFilm(db, filmDir: string, summary: string): Promise<{ fileId: string; version: number }>`
  - 片子目录内容：`data.json`（`{ projectId, version, durationSec, video: 'raw<ext>', captions, materials: [{ id, file: 'm-<id><ext>', mediaType, durationSec, note }] }`）、`public/raw<ext>` 与 `public/m-<id><ext>`（硬链接，跨盘时复制）、`index.tsx`、`Film.tsx`、`copy.ts`、`shots.json`（按转写每句一镜的初始骨架）。

- [ ] **Step 1: 扩展假库 `projectFile`**

在 `tests/helpers/fake-db.ts` 的 `projectFile: {` 对象里，`findFirst` 之后追加：

```ts
      findMany: async ({ where }: { where: { projectId?: string; kind?: string } }) =>
        files
          .filter((f) => (!where.projectId || f.projectId === where.projectId) && (!where.kind || f.kind === where.kind))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((f) => ({ ...f })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeFile> }) => {
        const f = files.find((x) => x.id === where.id);
        if (!f) throw new Error('not found');
        Object.assign(f, data);
        return { ...f };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = files.findIndex((x) => x.id === where.id);
        if (i < 0) throw new Error('not found');
        return files.splice(i, 1)[0];
      },
```

- [ ] **Step 2: 写失败测试**

`tests/lib/film/bundle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFilmBundle } from '@/lib/film/bundle';
import { createFakeDb } from '../../helpers/fake-db';

async function setup(opts: { withTranscript?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-fb-'));
  const tPath = path.join(dir, 'transcript.v1.json');
  await fs.writeFile(tPath, JSON.stringify({ lines: [{ startSec: 0, endSec: 2, text: '你好' }], rawLines: [], durationSec: 79.2, proofread: 'done' }));
  const files = [
    { kind: 'raw_video', version: 1, path: path.join(dir, 'raw.v1.mov'), meta: { durationSec: 79.2 } },
    ...(opts.withTranscript === false ? [] : [{ kind: 'transcript', version: 1, path: tPath }]),
    { kind: 'material', version: 1, path: path.join(dir, 'material-a.png'), meta: { note: '讲笨办法时放', originalName: 'u.png', mediaType: 'image' } },
    { kind: 'material', version: 1, path: path.join(dir, 'material-b.mov'), meta: { note: '', originalName: 'rec.mov', mediaType: 'video', durationSec: 40 } },
  ];
  return createFakeDb({ project: { title: 'U盘', stage: 'recorded' }, files });
}
const probe = async () => ({ width: 1258, height: 2246 });

describe('buildFilmBundle', () => {
  it('collects project, transcript, video and materials with absolute paths', async () => {
    const { db } = await setup();
    const b = await buildFilmBundle(db, 'p1', probe);
    expect(b.project).toMatchObject({ id: 'p1', title: 'U盘' });
    expect(b.transcript).toEqual([{ startSec: 0, endSec: 2, text: '你好' }]);
    expect(b.video).toMatchObject({ ext: '.mov', durationSec: 79.2, width: 1258, height: 2246 });
    expect(b.materials.map((m) => [m.mediaType, m.note, m.ext, m.durationSec])).toEqual([
      ['image', '讲笨办法时放', '.png', null],
      ['video', '', '.mov', 40],
    ]);
  });
  it('refuses when the recording has not been transcribed', async () => {
    const { db } = await setup({ withTranscript: false });
    await expect(buildFilmBundle(db, 'p1', probe)).rejects.toThrow('这个项目还没有转写好的口播，先在「② 口播」上传并等转写完成。');
  });
});
```

`tests/lib/film/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nextFilmVersion, scaffoldFilm } from '@/lib/film/scaffold';
import type { FilmBundle } from '@/lib/film/bundle';
import { createFakeDb } from '../../helpers/fake-db';

async function bundleIn(dir: string): Promise<FilmBundle> {
  const video = path.join(dir, 'raw.v1.mov');
  const img = path.join(dir, 'material-a.png');
  await fs.writeFile(video, 'v');
  await fs.writeFile(img, 'i');
  return {
    project: { id: 'p1', title: 'U盘', stage: 'recorded', targetSec: 60 },
    script: null,
    transcript: [
      { startSec: 0, endSec: 3.2, text: '第一句' },
      { startSec: 3.2, endSec: 7, text: '第二句' },
    ],
    video: { path: video, ext: '.mov', durationSec: 7, width: 1080, height: 1920 },
    materials: [{ id: 'fa', path: img, ext: '.png', mediaType: 'image', note: '放这', originalName: 'u.png', durationSec: null }],
  };
}

describe('nextFilmVersion', () => {
  it('is one past the highest registered film', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const { db } = createFakeDb({ files: [{ kind: 'final_mp4', meta: { filmVersion: 2 } }] });
    expect(await nextFilmVersion(db, 'p1', root)).toBe(3);
  });
  it('skips versions whose directory already exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    await fs.mkdir(path.join(root, 'p1-v1'));
    const { db } = createFakeDb();
    expect(await nextFilmVersion(db, 'p1', root)).toBe(2);
  });
});

describe('scaffoldFilm', () => {
  it('creates data.json, linked media, entry files and a shot per transcript line', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const filmDir = await scaffoldFilm(await bundleIn(dir), 1, root);
    expect(filmDir).toBe(path.join(root, 'p1-v1'));
    const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8'));
    expect(data).toMatchObject({ projectId: 'p1', version: 1, durationSec: 7, video: 'raw.mov' });
    expect(data.materials[0]).toMatchObject({ id: 'fa', file: 'm-fa.png', mediaType: 'image', note: '放这' });
    expect(await fs.readFile(path.join(filmDir, 'public', 'raw.mov'), 'utf8')).toBe('v');
    expect(await fs.readFile(path.join(filmDir, 'public', 'm-fa.png'), 'utf8')).toBe('i');
    for (const f of ['index.tsx', 'Film.tsx', 'copy.ts']) await expect(fs.access(path.join(filmDir, f))).resolves.toBeUndefined();
    const shots = JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8'));
    expect(shots.shots.map((s: { fromSec: number; toSec: number }) => [s.fromSec, s.toSec])).toEqual([
      [0, 3.2],
      [3.2, 7],
    ]);
  });
  it('refuses to overwrite an existing film directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    await fs.mkdir(path.join(root, 'p1-v1'));
    await expect(scaffoldFilm(await bundleIn(dir), 1, root)).rejects.toThrow('片子目录已存在');
  });
});
```

`tests/lib/film/register.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerFilm } from '@/lib/film/register';
import { createFakeDb } from '../../helpers/fake-db';

async function filmDir(withMp4 = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
  const projRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-proj-'));
  const dir = path.join(root, 'p1-v2');
  await fs.mkdir(path.join(dir, 'out'), { recursive: true });
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify({ projectId: 'p1', version: 2 }));
  await fs.writeFile(
    path.join(dir, 'shots.json'),
    JSON.stringify({ version: 1, shots: [
      { id: 'a', fromSec: 0, toSec: 5, intent: '开场' },
      { id: 'b', fromSec: 5, toSec: 12, intent: '录屏', material: { id: 'fm', clipFromSec: 10, clipToSec: 20, speed: 1.5 } },
    ] }),
  );
  if (withMp4) await fs.writeFile(path.join(dir, 'out', 'final.mp4'), 'mp4data');
  process.env.PROJECT_FILES_ROOT = projRoot;
  return { dir, projRoot };
}

describe('registerFilm', () => {
  it('moves the mp4 into the project, records usage, advances the stage and posts a notice', async () => {
    const { dir, projRoot } = await filmDir();
    const { db, files, project, messages } = createFakeDb({ project: { stage: 'recorded' } });
    const r = await registerFilm(db, dir, '按新风格重排了冷知识段');
    expect(r.version).toBe(2);
    const f = files.find((x) => x.kind === 'final_mp4')!;
    expect(f.path).toBe(path.join(projRoot, 'p1', 'final.v2.mp4'));
    expect(await fs.readFile(f.path, 'utf8')).toBe('mp4data');
    expect(f.meta).toMatchObject({
      filmVersion: 2,
      sourceDir: dir,
      summary: '按新风格重排了冷知识段',
      usage: [{ materialId: 'fm', atSec: 5, durSec: 7, clipFromSec: 10, clipToSec: 20, speed: 1.5 }],
    });
    expect(project.stage).toBe('final');
    expect(messages.at(-1)).toMatchObject({ role: 'system', toolName: 'job:film', content: '成片 v2 已生成：按新风格重排了冷知识段', toolResult: { ok: true } });
  });
  it('refuses to register when the mp4 is missing or empty', async () => {
    const { dir } = await filmDir(false);
    const { db, files } = createFakeDb();
    await expect(registerFilm(db, dir, 'x')).rejects.toThrow('没找到成片');
    expect(files).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/film`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/film/shots.ts`**

```ts
import { z } from 'zod';

export const ShotsFileSchema = z.object({
  version: z.literal(1),
  shots: z.array(
    z.object({
      id: z.string().min(1),
      fromSec: z.number().min(0),
      toSec: z.number().positive(),
      intent: z.string(),
      material: z
        .object({
          id: z.string().min(1),
          clipFromSec: z.number().min(0).optional(),
          clipToSec: z.number().positive().optional(),
          speed: z.number().positive().optional(),
        })
        .optional(),
    }),
  ),
});
export type ShotsFile = z.infer<typeof ShotsFileSchema>;
```

- [ ] **Step 5: 实现 `src/lib/film/bundle.ts`**

```ts
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, type Script } from '@/lib/script/model';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { probeVideoDimensions } from '@/lib/video/ffmpeg';

export interface FilmBundle {
  project: { id: string; title: string; stage: string; targetSec: number };
  script: Script | null;
  transcript: { startSec: number; endSec: number; text: string }[];
  video: { path: string; ext: string; durationSec: number; width: number; height: number } | null;
  materials: { id: string; path: string; ext: string; mediaType: 'image' | 'video'; note: string; originalName: string; durationSec: number | null }[];
}

type Meta = { durationSec?: unknown; note?: unknown; originalName?: unknown; mediaType?: unknown };

/** 出片用的资料包: 稿子、当前版本的逐句转写、口播原片、素材(绝对路径 + 说明)。 */
export async function buildFilmBundle(
  db: PrismaClient,
  projectId: string,
  probe: (p: string) => Promise<{ width: number; height: number }> = probeVideoDimensions,
): Promise<FilmBundle> {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error(`没有编号为 ${projectId} 的项目`);
  const t = await loadCurrentTranscript(db, projectId);
  if (!t) throw new Error('这个项目还没有转写好的口播，先在「② 口播」上传并等转写完成。');
  const video = await db.projectFile.findFirst({ where: { projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
  const materials = await db.projectFile.findMany({ where: { projectId, kind: 'material' }, orderBy: { createdAt: 'asc' } });
  const parsed = ScriptSchema.safeParse(p.script);

  let v: FilmBundle['video'] = null;
  if (video) {
    const meta = (video.meta ?? {}) as Meta;
    const dims = await probe(video.path);
    v = {
      path: video.path,
      ext: path.extname(video.path).toLowerCase(),
      durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : t.data.durationSec,
      width: dims.width,
      height: dims.height,
    };
  }
  return {
    project: { id: p.id, title: p.title, stage: p.stage, targetSec: p.targetSec },
    script: parsed.success ? parsed.data : null,
    transcript: t.data.lines.map((l) => ({ startSec: l.startSec, endSec: l.endSec, text: l.text })),
    video: v,
    materials: materials.map((m) => {
      const meta = (m.meta ?? {}) as Meta;
      return {
        id: m.id,
        path: m.path,
        ext: path.extname(m.path).toLowerCase(),
        mediaType: meta.mediaType === 'video' ? 'video' : 'image',
        note: typeof meta.note === 'string' ? meta.note : '',
        originalName: typeof meta.originalName === 'string' ? meta.originalName : path.basename(m.path),
        durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : null,
      };
    }),
  };
}
```

- [ ] **Step 6: 实现 `src/lib/film/scaffold.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { FilmBundle } from './bundle';
import type { ShotsFile } from './shots';

export function filmsRoot(): string {
  return process.env.FILMS_ROOT || path.join(process.cwd(), 'remotion', 'films');
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** 已登记的最大版本 +1; 若该版本目录已存在(上次没登记), 继续往后找 */
export async function nextFilmVersion(db: PrismaClient, projectId: string, root = filmsRoot()): Promise<number> {
  const films = await db.projectFile.findMany({ where: { projectId, kind: 'final_mp4' } });
  let v = films.reduce((max, f) => Math.max(max, Number((f.meta as { filmVersion?: unknown })?.filmVersion) || 0), 0) + 1;
  while (await exists(path.join(root, `${projectId}-v${v}`))) v++;
  return v;
}

/** 硬链接(同盘不占空间, 不拷 181MB); 跨盘时退回复制 */
async function linkOrCopy(src: string, dest: string) {
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
}

const INDEX = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, W, H } from '../../kit';
import data from './data.json';
import { Film } from './Film';

registerRoot(() => (
  <Composition id="Film" component={Film} durationInFrames={Math.ceil(data.durationSec * FPS)} fps={FPS} width={W} height={H} />
));
`;

const FILM = `import React from 'react';
import { Frame, Shot, Note, Kicker } from '../../kit';
import data from './data.json';
import { COPY } from './copy';

/** 由 produce-film 流程改写: 只写内容区, 画框/小窗/字幕由 Frame 负责 */
export const Film: React.FC = () => (
  <Frame video={data.video} captions={data.captions}>
    <Shot from={0} to={data.durationSec}>
      <Note>
        <Kicker>{COPY.kicker}</Kicker>
      </Note>
    </Shot>
  </Frame>
);
`;

const COPY_TS = `/** 画面上的所有文字放这里(film check 只在这里查数字) */
export const COPY = {
  kicker: '草稿',
};
`;

export async function scaffoldFilm(bundle: FilmBundle, version: number, root = filmsRoot()): Promise<string> {
  if (!bundle.video) throw new Error('这个项目还没有口播视频');
  const dir = path.join(root, `${bundle.project.id}-v${version}`);
  if (await exists(dir)) throw new Error(`片子目录已存在：${dir}`);
  await fs.mkdir(path.join(dir, 'public'), { recursive: true });

  const videoFile = `raw${bundle.video.ext}`;
  await linkOrCopy(bundle.video.path, path.join(dir, 'public', videoFile));
  const materials = [];
  for (const m of bundle.materials) {
    const file = `m-${m.id}${m.ext}`;
    await linkOrCopy(m.path, path.join(dir, 'public', file));
    materials.push({ id: m.id, file, mediaType: m.mediaType, durationSec: m.durationSec, note: m.note, originalName: m.originalName });
  }
  const data = {
    projectId: bundle.project.id,
    version,
    durationSec: bundle.video.durationSec,
    video: videoFile,
    captions: bundle.transcript,
    materials,
  };
  const shots: ShotsFile = {
    version: 1,
    shots: bundle.transcript.map((l, i) => ({
      id: `s${i + 1}`,
      fromSec: i === 0 ? 0 : l.startSec,
      toSec: i === bundle.transcript.length - 1 ? bundle.video!.durationSec : bundle.transcript[i + 1].startSec,
      intent: l.text,
    })),
  };
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify(data, null, 2));
  await fs.writeFile(path.join(dir, 'shots.json'), JSON.stringify(shots, null, 2));
  await fs.writeFile(path.join(dir, 'index.tsx'), INDEX);
  await fs.writeFile(path.join(dir, 'Film.tsx'), FILM);
  await fs.writeFile(path.join(dir, 'copy.ts'), COPY_TS);
  return dir;
}
```

注：骨架里第一镜从 0 开始、镜头边界取下一句开头，保证首尾相接；最后一镜延伸到原片结束。

- [ ] **Step 7: 实现 `src/lib/film/register.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, Prisma } from '@prisma/client';
import { projectDir } from '@/lib/files/storage';
import { ShotsFileSchema } from './shots';

const ADVANCE_FROM = ['draft', 'scripted', 'recorded'];

/** 登记成片: 移入项目目录 → 建 final_mp4 行(带素材使用表) → 推进阶段 → 对话里发通知 */
export async function registerFilm(db: PrismaClient, filmDir: string, summary: string): Promise<{ fileId: string; version: number }> {
  const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8')) as { projectId: string; version: number };
  const mp4 = path.join(filmDir, 'out', 'final.mp4');
  const stat = await fs.stat(mp4).catch(() => null);
  if (!stat || stat.size === 0) throw new Error(`没找到成片：${mp4}（先运行 mp film render）`);
  const shots = ShotsFileSchema.parse(JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8')));
  const usage = shots.shots
    .filter((s) => s.material)
    .map((s) => ({
      materialId: s.material!.id,
      atSec: s.fromSec,
      durSec: Math.round((s.toSec - s.fromSec) * 100) / 100,
      ...(s.material!.clipFromSec !== undefined ? { clipFromSec: s.material!.clipFromSec } : {}),
      ...(s.material!.clipToSec !== undefined ? { clipToSec: s.material!.clipToSec } : {}),
      ...(s.material!.speed !== undefined ? { speed: s.material!.speed } : {}),
    }));

  const dest = path.join(projectDir(data.projectId), `final.v${data.version}.mp4`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(mp4, dest);
  } catch {
    await fs.copyFile(mp4, dest);
    await fs.unlink(mp4).catch(() => {});
  }
  const file = await db.projectFile.create({
    data: {
      projectId: data.projectId,
      kind: 'final_mp4',
      path: dest,
      version: data.version,
      meta: { filmVersion: data.version, sourceDir: filmDir, summary, usage } as Prisma.InputJsonValue,
    },
  });
  const p = await db.project.findUniqueOrThrow({ where: { id: data.projectId } });
  if (ADVANCE_FROM.includes(p.stage)) await db.project.update({ where: { id: data.projectId }, data: { stage: 'final' } });
  await db.chatMessage.create({
    data: { projectId: data.projectId, role: 'system', content: `成片 v${data.version} 已生成：${summary}`, toolName: 'job:film', toolResult: { ok: true } },
  });
  return { fileId: file.id, version: data.version };
}
```

- [ ] **Step 8: 运行确认通过**

Run: `npx vitest run tests/lib/film && npm run typecheck && npm test`
Expected: film 测试全部 PASS；0 错误；全量全绿。

- [ ] **Step 9: Commit**

```bash
git add src/lib/film tests/lib/film tests/helpers/fake-db.ts
git commit -m "feat(film): 资料包导出 / 片子骨架(硬链接素材) / 成片登记(素材使用表/阶段/通知)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `film check` 检查规则

**Files:**
- Create: `src/lib/film/check.ts`
- Test: `tests/lib/film/check.test.ts`

**Interfaces:**
- Consumes: `ShotsFile`（Task 4）。
- Produces:
  - `interface FilmData { durationSec: number; captions: { text: string }[]; materials: { id: string; file: string; mediaType: 'image' | 'video'; durationSec: number | null }[] }`
  - `checkShots(shots: ShotsFile, data: FilmData, publicFiles: Set<string>): string[]`（覆盖、单镜时长、素材存在/截取/加速/能否放下）
  - `numberTokens(text: string): string[]`、`toChineseNumber(n: number): string | null`（0–99999 的简单写法）
  - `checkNumbers(copyText: string, sources: string[]): string[]`
  - 所有返回的字符串是中文、带实际值的问题描述；空数组 = 通过。

- [ ] **Step 1: 写失败测试 `tests/lib/film/check.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { checkShots, checkNumbers, numberTokens, toChineseNumber } from '@/lib/film/check';
import type { ShotsFile } from '@/lib/film/shots';

const data = {
  durationSec: 20,
  captions: [{ text: '半年后干到类目第一' }],
  materials: [
    { id: 'img', file: 'm-img.png', mediaType: 'image' as const, durationSec: null },
    { id: 'rec', file: 'm-rec.mov', mediaType: 'video' as const, durationSec: 30 },
  ],
};
const files = new Set(['raw.mov', 'm-img.png', 'm-rec.mov']);
const shots = (list: ShotsFile['shots']): ShotsFile => ({ version: 1, shots: list });

describe('checkShots', () => {
  it('passes a contiguous plan covering the whole recording', () => {
    expect(checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 8, intent: '' },
      { id: 'b', fromSec: 8, toSec: 20, intent: '', material: { id: 'rec', clipFromSec: 5, clipToSec: 20, speed: 1.5 } },
    ]), data, files)).toEqual([]);
  });
  it('reports gaps, overlaps, uncovered tail and bad shot lengths with actual values', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0.5, toSec: 6, intent: '' },
      { id: 'b', fromSec: 7, toSec: 7.5, intent: '' },
      { id: 'c', fromSec: 7.2, toSec: 19.5, intent: '' },
    ]), data, files);
    expect(issues).toContain('第一个镜头要从 0 秒开始，现在是 0.5 秒');
    expect(issues).toContain('镜头 a 与 b 之间空了 1 秒（6 → 7）');
    expect(issues).toContain('镜头 b 与 c 重叠了 0.3 秒（7.5 → 7.2）');
    expect(issues).toContain('镜头 b 只有 0.5 秒，最短 1 秒');
    expect(issues).toContain('镜头 c 超过 12 秒（12.3 秒）');
    expect(issues).toContain('最后一个镜头到 19.5 秒结束，口播有 20 秒');
  });
  it('reports a missing material file', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 10, intent: '', material: { id: 'img' } },
      { id: 'b', fromSec: 10, toSec: 20, intent: '' },
    ]), data, new Set(['raw.mov']));
    expect(issues).toEqual(['镜头 a 用的素材文件不存在：m-img.png']);
  });
  it('reports unknown materials, clips outside the source, speed above 2x and clips that do not fit', () => {
    const issues = checkShots(shots([
      { id: 'a', fromSec: 0, toSec: 5, intent: '', material: { id: 'nope' } },
      { id: 'b', fromSec: 5, toSec: 10, intent: '', material: { id: 'rec', clipFromSec: 25, clipToSec: 35 } },
      { id: 'c', fromSec: 10, toSec: 15, intent: '', material: { id: 'rec', clipFromSec: 0, clipToSec: 12, speed: 2.5 } },
      { id: 'd', fromSec: 15, toSec: 20, intent: '', material: { id: 'rec', clipFromSec: 0, clipToSec: 20, speed: 2 } },
    ]), data, files);
    expect(issues).toContain('镜头 a 引用了不存在的素材 nope');
    expect(issues).toContain('镜头 b 截取到 35 秒，素材只有 30 秒');
    expect(issues).toContain('镜头 c 加速 2.5 倍，最多 2 倍');
    expect(issues).toContain('镜头 d 截取 20 秒 ÷ 2 倍 = 10 秒，放不进 5 秒的镜头');
  });
});

describe('numbers', () => {
  it('extracts number tokens, normalising thousands separators and percent', () => {
    expect(numberTokens('卖了 6,000 单，复购 32.5%，Top1')).toEqual(['6000', '32.5', '1']);
  });
  it('converts simple numbers to Chinese', () => {
    expect(toChineseNumber(50)).toBe('五十');
    expect(toChineseNumber(6000)).toBe('六千');
    expect(toChineseNumber(15)).toBe('十五');
    expect(toChineseNumber(305)).toBe('三百零五');
  });
  it('accepts numbers that appear in Chinese form', () => {
    expect(checkNumbers("export const COPY = { a: '50+ 岁的老板', b: '6000 单' }", ['买它的人有五十多岁', '卖了六千多单'])).toEqual([]);
  });
  it('flags a number that appears nowhere in the script or transcript', () => {
    expect(checkNumbers("export const COPY = { a: '转化率提升 300%' }", ['半年后干到类目第一'])).toEqual([
      '画面数字 300 在稿子和转写里都找不到（可能是编造的）',
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film/check.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/film/check.ts`**

```ts
import type { ShotsFile } from './shots';

export interface FilmData {
  durationSec: number;
  captions: { text: string }[];
  materials: { id: string; file: string; mediaType: 'image' | 'video'; durationSec: number | null }[];
}

const EPS = 0.05;
const MIN_SHOT = 1;
const MAX_SHOT = 12;
const MAX_SPEED = 2;
const r = (n: number) => Math.round(n * 100) / 100;

export function checkShots(file: ShotsFile, data: FilmData, publicFiles: Set<string>): string[] {
  const issues: string[] = [];
  const shots = [...file.shots].sort((a, b) => a.fromSec - b.fromSec);
  if (shots.length === 0) return ['镜头表是空的'];
  if (shots[0].fromSec > EPS) issues.push(`第一个镜头要从 0 秒开始，现在是 ${r(shots[0].fromSec)} 秒`);
  shots.forEach((s, i) => {
    const len = s.toSec - s.fromSec;
    if (len < MIN_SHOT) issues.push(`镜头 ${s.id} 只有 ${r(len)} 秒，最短 ${MIN_SHOT} 秒`);
    if (len > MAX_SHOT) issues.push(`镜头 ${s.id} 超过 ${MAX_SHOT} 秒（${r(len)} 秒）`);
    const next = shots[i + 1];
    if (next) {
      const gap = next.fromSec - s.toSec;
      if (gap > EPS) issues.push(`镜头 ${s.id} 与 ${next.id} 之间空了 ${r(gap)} 秒（${r(s.toSec)} → ${r(next.fromSec)}）`);
      if (gap < -EPS) issues.push(`镜头 ${s.id} 与 ${next.id} 重叠了 ${r(-gap)} 秒（${r(s.toSec)} → ${r(next.fromSec)}）`);
    }
    if (s.material) {
      const m = data.materials.find((x) => x.id === s.material!.id);
      if (!m) {
        issues.push(`镜头 ${s.id} 引用了不存在的素材 ${s.material.id}`);
        return;
      }
      if (!publicFiles.has(m.file)) {
        issues.push(`镜头 ${s.id} 用的素材文件不存在：${m.file}`);
        return;
      }
      if (m.mediaType === 'video') {
        const from = s.material.clipFromSec ?? 0;
        const to = s.material.clipToSec ?? m.durationSec ?? from + len;
        const speed = s.material.speed ?? 1;
        if (m.durationSec !== null && to > m.durationSec + EPS) issues.push(`镜头 ${s.id} 截取到 ${r(to)} 秒，素材只有 ${r(m.durationSec)} 秒`);
        if (speed > MAX_SPEED) issues.push(`镜头 ${s.id} 加速 ${speed} 倍，最多 ${MAX_SPEED} 倍`);
        else if ((to - from) / speed > len + EPS)
          issues.push(`镜头 ${s.id} 截取 ${r(to - from)} 秒 ÷ ${speed} 倍 = ${r((to - from) / speed)} 秒，放不进 ${r(len)} 秒的镜头`);
      }
    }
  });
  const last = shots[shots.length - 1];
  if (last.toSec < data.durationSec - EPS) issues.push(`最后一个镜头到 ${r(last.toSec)} 秒结束，口播有 ${r(data.durationSec)} 秒`);
  return issues;
}

/** 文本里的数字(去掉千分位逗号; 百分号不影响数值) */
export function numberTokens(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => s.replace(/,/g, ''));
}

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千', '万'];

/** 0–99999 的简单中文写法(五十、六千、三百零五); 其余返回 null */
export function toChineseNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99999) return null;
  if (n < 10) return DIGITS[n];
  const ds = String(n).split('').map(Number);
  let out = '';
  let zero = false;
  ds.forEach((d, i) => {
    const unit = UNITS[ds.length - 1 - i];
    if (d === 0) {
      zero = out !== '';
      return;
    }
    if (zero) out += '零';
    zero = false;
    out += (d === 1 && unit === '十' && i === 0 ? '' : DIGITS[d]) + unit;
  });
  return out;
}

/** 画面文字(copy.ts 全文)里的每个数字, 必须能在稿子或转写里以阿拉伯数字或中文写法找到 */
export function checkNumbers(copyText: string, sources: string[]): string[] {
  const src = sources.join('\n').replace(/,/g, '');
  const srcNums = new Set(numberTokens(src));
  const issues: string[] = [];
  for (const tok of new Set(numberTokens(copyText))) {
    if (srcNums.has(tok)) continue;
    const cn = toChineseNumber(Number(tok));
    if (cn && src.includes(cn)) continue;
    issues.push(`画面数字 ${tok} 在稿子和转写里都找不到（可能是编造的）`);
  }
  return issues;
}
```

注：`Top1` 里的 `1` 若稿子有「第一」，`toChineseNumber(1)` = `一`，`src.includes('一')` 几乎总成立——个位数基本放行，这是有意的宽松（个位数误报远多于真编造）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/film && npm run typecheck`
Expected: 全部 PASS；0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/lib/film/check.ts tests/lib/film/check.test.ts
git commit -m "feat(film): film check 规则(镜头覆盖/素材截取与加速/画面数字必须有出处)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 素材上传与说明（主项目）

**Files:**
- Create: `src/lib/film/materials.ts`、`src/app/api/projects/[id]/materials/route.ts`、`src/app/api/projects/[id]/materials/[fileId]/route.ts`
- Modify: `src/app/api/projects/[id]/files/[fileId]/route.ts`（图片类型）
- Test: `tests/lib/film/materials.test.ts`

**Interfaces:**
- Consumes: `saveStreamToFile`、`projectDir`（阶段 3）；`probeVideo`、`probeVideoDimensions`。
- Produces:
  - `IMAGE_EXTS`、`materialType(filename: string): 'image' | 'video' | null`
  - `decodeNote(header: string | null): string`（`decodeURIComponent`，失败返回空串，截断 200 字）
  - `createMaterial(db, opts: { projectId: string; tempPath: string; originalName: string; note: string; probe: { durationSec: number | null; width: number; height: number } }): Promise<{ id: string }>`（改名为 `material-<uuid><ext>`）
  - `updateMaterialNote(db, projectId, fileId, note): Promise<void>`、`deleteMaterial(db, projectId, fileId): Promise<void>`（同时删文件；不属于该项目或不是素材时抛"素材不存在"）
  - HTTP：`PUT /api/projects/:id/materials`（头 `x-filename`、`x-note` 均为 `encodeURIComponent`）→ `{ id }`；`PATCH /api/projects/:id/materials/:fileId` `{ note }`；`DELETE /api/projects/:id/materials/:fileId`。

- [ ] **Step 1: 写失败测试 `tests/lib/film/materials.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materialType, decodeNote, createMaterial, updateMaterialNote, deleteMaterial } from '@/lib/film/materials';
import { createFakeDb } from '../../helpers/fake-db';

describe('materialType', () => {
  it('classifies images and videos, rejects others', () => {
    expect(materialType('a.PNG')).toBe('image');
    expect(materialType('a.webp')).toBe('image');
    expect(materialType('rec.mov')).toBe('video');
    expect(materialType('a.gif')).toBeNull();
  });
});

describe('decodeNote', () => {
  it('decodes a multi-line Chinese note from the header', () => {
    expect(decodeNote(encodeURIComponent('讲笨办法时放\n用 0:10～0:40'))).toBe('讲笨办法时放\n用 0:10～0:40');
  });
  it('returns empty for missing or malformed headers and caps the length', () => {
    expect(decodeNote(null)).toBe('');
    expect(decodeNote('%E4%')).toBe('');
    expect(decodeNote(encodeURIComponent('字'.repeat(300)))).toHaveLength(200);
  });
});

describe('material lifecycle', () => {
  it('creates, renames the temp file, edits the note and deletes file + row', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-mat-'));
    const temp = path.join(dir, 'upload-x.part');
    await fs.writeFile(temp, 'img');
    const { db, files } = createFakeDb();
    const { id } = await createMaterial(db, { projectId: 'p1', tempPath: temp, originalName: '截图.png', note: '放这', probe: { durationSec: null, width: 800, height: 600 } });
    const f = files.find((x) => x.id === id)!;
    expect(path.basename(f.path)).toMatch(/^material-[0-9a-f-]+\.png$/);
    expect(f.meta).toMatchObject({ note: '放这', originalName: '截图.png', mediaType: 'image', width: 800, height: 600 });
    await updateMaterialNote(db, 'p1', id, '改成讲冷知识时放');
    expect((files.find((x) => x.id === id)!.meta as { note: string }).note).toBe('改成讲冷知识时放');
    await deleteMaterial(db, 'p1', id);
    expect(files.find((x) => x.id === id)).toBeUndefined();
    await expect(fs.access(f.path)).rejects.toThrow();
  });
  it('refuses to touch a file that is not a material of this project', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video', path: '/tmp/x' }] });
    const rawId = (await db.projectFile.findFirst({ where: { kind: 'raw_video' } }))!.id;
    await expect(deleteMaterial(db, 'p1', rawId)).rejects.toThrow('素材不存在');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film/materials.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/film/materials.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { VIDEO_EXTS } from '@/lib/files/storage';

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export function materialType(filename: string): 'image' | 'video' | null {
  const ext = path.extname(filename).toLowerCase();
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return 'image';
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return 'video';
  return null;
}

export function decodeNote(header: string | null): string {
  if (!header) return '';
  try {
    return decodeURIComponent(header).slice(0, 200);
  } catch {
    return '';
  }
}

export async function createMaterial(
  db: PrismaClient,
  opts: { projectId: string; tempPath: string; originalName: string; note: string; probe: { durationSec: number | null; width: number; height: number } },
): Promise<{ id: string }> {
  const mediaType = materialType(opts.originalName);
  if (!mediaType) throw new Error('只支持 png / jpg / webp 图片和 mp4 / mov / m4v 视频');
  const dest = path.join(path.dirname(opts.tempPath), `material-${randomUUID()}${path.extname(opts.originalName).toLowerCase()}`);
  await fs.rename(opts.tempPath, dest);
  const f = await db.projectFile.create({
    data: {
      projectId: opts.projectId,
      kind: 'material',
      path: dest,
      version: 1,
      meta: {
        note: opts.note,
        originalName: opts.originalName,
        mediaType,
        width: opts.probe.width,
        height: opts.probe.height,
        ...(opts.probe.durationSec !== null ? { durationSec: opts.probe.durationSec } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  return { id: f.id };
}

async function findMaterial(db: PrismaClient, projectId: string, fileId: string) {
  const f = await db.projectFile.findFirst({ where: { id: fileId, projectId, kind: 'material' } });
  if (!f) throw new Error('素材不存在');
  return f;
}

export async function updateMaterialNote(db: PrismaClient, projectId: string, fileId: string, note: string): Promise<void> {
  const f = await findMaterial(db, projectId, fileId);
  await db.projectFile.update({ where: { id: f.id }, data: { meta: { ...(f.meta as object), note: note.slice(0, 200) } as Prisma.InputJsonValue } });
}

export async function deleteMaterial(db: PrismaClient, projectId: string, fileId: string): Promise<void> {
  const f = await findMaterial(db, projectId, fileId);
  await db.projectFile.delete({ where: { id: f.id } });
  await fs.unlink(f.path).catch(() => {});
}
```

注：假库 `projectFile.findFirst` 需同时按 `id`、`projectId`、`kind` 过滤——阶段 3 的假库已支持这三个字段。

- [ ] **Step 4: 上传接口 `src/app/api/projects/[id]/materials/route.ts`**

```ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { projectDir, saveStreamToFile } from '@/lib/files/storage';
import { probeVideo, probeVideoDimensions } from '@/lib/video/ffmpeg';
import { materialType, decodeNote, createMaterial } from '@/lib/film/materials';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  const name = decodeNote(req.headers.get('x-filename'));
  const type = materialType(name);
  if (!type) return fail('只支持 png / jpg / webp 图片和 mp4 / mov / m4v 视频', 400);
  if (!req.body) return fail('没收到文件', 400);

  const temp = path.join(projectDir(project.id), `upload-${randomUUID()}.part`);
  try {
    await saveStreamToFile(Readable.fromWeb(req.body as unknown as WebReadableStream), temp);
  } catch {
    return fail('上传中断了，文件没存完整。重新拖进来再传一次。', 400);
  }
  let probe: { durationSec: number | null; width: number; height: number };
  try {
    const dims = await probeVideoDimensions(temp);
    probe = { width: dims.width, height: dims.height, durationSec: type === 'video' ? (await probeVideo(temp)).durationSec : null };
  } catch {
    await fs.unlink(temp).catch(() => {});
    return fail('这个文件读不出来，可能已经损坏。', 400);
  }
  const { id } = await createMaterial(prisma, { projectId: project.id, tempPath: temp, originalName: name, note: decodeNote(req.headers.get('x-note')), probe });
  return ok({ id });
}
```

- [ ] **Step 5: 说明与删除接口 `src/app/api/projects/[id]/materials/[fileId]/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { updateMaterialNote, deleteMaterial } from '@/lib/film/materials';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string; fileId: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  if (typeof body.note !== 'string') return fail('说明要是文字', 400);
  try {
    await updateMaterialNote(prisma, params.id, params.fileId, body.note);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
  return ok({ id: params.fileId });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await deleteMaterial(prisma, params.id, params.fileId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
  return ok({ id: params.fileId });
}
```

- [ ] **Step 6: 文件读取支持图片**

`src/app/api/projects/[id]/files/[fileId]/route.ts` 的 `TYPES` 追加：

```ts
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
```

- [ ] **Step 7: 测试 + 类型检查**

Run: `npx vitest run tests/lib/film && npm run typecheck && npm test`
Expected: 全部 PASS；0 错误。

- [ ] **Step 8: 真机冒烟**

`npm run dev` 运行中（新路由），对验收项目 `cmujxgbz6000eg417ngfzoolz`：

```bash
T=cmujxgbz6000eg417ngfzoolz
ffmpeg -loglevel error -y -ss 30 -i ~/mediapilot-archive/video-productions/51525511-00d/source.mov -frames:v 1 /tmp/mp-shot.png
curl -s -X PUT localhost:3000/api/projects/$T/materials -H "x-filename: $(node -pe 'encodeURIComponent("截图.png")')" -H "x-note: $(node -pe 'encodeURIComponent("讲笨办法时放")')" --data-binary @/tmp/mp-shot.png; echo
curl -s -X PUT localhost:3000/api/projects/$T/materials -H 'x-filename: a.gif' --data-binary 'x'; echo
```
Expected: 第一条 `{"success":true,"data":{"id":"..."}}`；第二条 `只支持 png / jpg / webp 图片和 mp4 / mov / m4v 视频`。用 `psql` 查 `ProjectFile` 该行 `meta.note = 讲笨办法时放`。

- [ ] **Step 9: Commit**

```bash
git add src/lib/film/materials.ts "src/app/api/projects/[id]/materials" "src/app/api/projects/[id]/files" tests/lib/film/materials.test.ts
git commit -m "feat(film): 素材上传(图片/视频, 流式)与说明编辑/删除

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `mp` 命令行

**Files:**
- Create: `scripts/mp.ts`
- Modify: `package.json`（`"mp": "tsx scripts/mp.ts"`）

**Interfaces:**
- Consumes: Task 4、5 的全部导出；`prisma`。
- Produces（命令）：
  - `npm run -s mp -- project list`
  - `npm run -s mp -- project export <id>` → 打印 `FilmBundle` JSON
  - `npm run -s mp -- film new <id>` → 打印片子目录
  - `npm run -s mp -- film check <filmDir>` → 通过打印 `film check 通过`；失败逐条打印并退出码 1。依次：`remotion/` 的 `tsc --noEmit`、`checkShots`、`checkNumbers(copy.ts, [稿子全文, 转写全文])`
  - `npm run -s mp -- film render <filmDir> --stills` → 每镜一张静帧（秒数 = `min(fromSec + 1.2, (fromSec + toSec) / 2)`），打印路径
  - `npm run -s mp -- film render <filmDir>` → `<filmDir>/out/final.mp4`
  - `npm run -s mp -- film register <filmDir> --summary <文字>`

- [ ] **Step 1: 实现 `scripts/mp.ts`**

```ts
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prisma } from '@/lib/prisma';
import { buildFilmBundle } from '@/lib/film/bundle';
import { nextFilmVersion, scaffoldFilm } from '@/lib/film/scaffold';
import { registerFilm } from '@/lib/film/register';
import { ShotsFileSchema } from '@/lib/film/shots';
import { checkShots, checkNumbers, type FilmData } from '@/lib/film/check';

/**
 * Claude Code 出片用的命令行。说明见 .claude/skills/produce-film/SKILL.md。
 * 渲染一律经这里调用 remotion/scripts/render.ts, 主项目从不 import remotion/。
 */
const ROOT = process.cwd();
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const RENDER = path.join(ROOT, 'remotion', 'scripts', 'render.ts');

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readFilm(filmDir: string) {
  const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8')) as FilmData & { projectId: string };
  const shots = ShotsFileSchema.parse(JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8')));
  return { data, shots };
}

function run(cmd: string, args: string[], cwd = ROOT): number {
  return spawnSync(cmd, args, { cwd, stdio: 'inherit' }).status ?? 1;
}

async function main() {
  const [group, cmd, ...rest] = process.argv.slice(2);

  if (group === 'project' && cmd === 'list') {
    const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
    for (const p of rows) console.log(`${p.id}\t${p.stage}\t${p.title}`);
    return;
  }
  if (group === 'project' && cmd === 'export') {
    console.log(JSON.stringify(await buildFilmBundle(prisma, rest[0]), null, 2));
    return;
  }
  if (group === 'film' && cmd === 'new') {
    const bundle = await buildFilmBundle(prisma, rest[0]);
    const version = await nextFilmVersion(prisma, rest[0]);
    console.log(await scaffoldFilm(bundle, version));
    return;
  }
  if (group === 'film' && cmd === 'check') {
    const filmDir = path.resolve(rest[0]);
    const issues: string[] = [];
    if (run('npx', ['tsc', '--noEmit', '-p', 'remotion']) !== 0) issues.push('remotion 类型检查没通过（见上方报错）');
    const { data, shots } = await readFilm(filmDir);
    const publicFiles = new Set(await fs.readdir(path.join(filmDir, 'public')));
    issues.push(...checkShots(shots, data, publicFiles));
    const p = await prisma.project.findUniqueOrThrow({ where: { id: data.projectId } });
    const scriptText = JSON.stringify(p.script ?? '');
    const copy = await fs.readFile(path.join(filmDir, 'copy.ts'), 'utf8');
    issues.push(...checkNumbers(copy, [scriptText, data.captions.map((c) => c.text).join('\n')]));
    if (issues.length) {
      for (const i of issues) console.log(`✗ ${i}`);
      process.exit(1);
    }
    console.log('film check 通过');
    return;
  }
  if (group === 'film' && cmd === 'render') {
    const filmDir = path.resolve(rest[0]);
    if (rest.includes('--stills')) {
      const { shots } = await readFilm(filmDir);
      const secs = shots.shots.map((s) => Math.round(Math.min(s.fromSec + 1.2, (s.fromSec + s.toSec) / 2) * 10) / 10);
      process.exit(run(TSX, [RENDER, filmDir, '--stills', secs.join(',')]));
    }
    await fs.mkdir(path.join(filmDir, 'out'), { recursive: true });
    process.exit(run(TSX, [RENDER, filmDir, '--out', path.join(filmDir, 'out', 'final.mp4')]));
  }
  if (group === 'film' && cmd === 'register') {
    const summary = flag(rest, '--summary');
    if (!summary) throw new Error('要写 --summary（这一版改了什么）');
    const r = await registerFilm(prisma, path.resolve(rest[0]), summary);
    console.log(`已登记成片 v${r.version}`);
    return;
  }
  console.log(`用法:
  mp project list
  mp project export <项目id>
  mp film new <项目id>
  mp film check <片子目录>
  mp film render <片子目录> [--stills]
  mp film register <片子目录> --summary <这一版改了什么>`);
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

`package.json` 的 `scripts` 追加：`"mp": "tsx scripts/mp.ts"`。

- [ ] **Step 2: 真机串一遍骨架片子（验收项目）**

```bash
npm run -s mp -- project list | head -3
npm run -s mp -- project export cmujxgbz6000eg417ngfzoolz | node -pe 'const b=JSON.parse(require("fs").readFileSync(0)); [b.transcript.length, b.video.width+"x"+b.video.height, b.materials.length].join(" ")'
F=$(npm run -s mp -- film new cmujxgbz6000eg417ngfzoolz); echo $F; ls $F $F/public
npm run -s mp -- film check $F
npm run -s mp -- film render $F --stills
```
Expected: 列出项目；资料包 `30 1258x2246 1`（30 句、原片尺寸、1 个素材）；片子目录含 `data.json shots.json index.tsx Film.tsx copy.ts public/raw.mov public/m-*.png`；`film check 通过`；30 张静帧生成（骨架只有一张"草稿"便签，用 Read 抽看 1 张确认画框正常）。然后删除该骨架目录 `rm -rf $F`（这不是正式出片）。

- [ ] **Step 3: 测试、类型检查、提交**

```bash
npm run typecheck && npm test
git add scripts/mp.ts package.json
git commit -m "feat(film): mp 命令行(项目列表/导出/建片/检查/渲染/登记)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 「③ 成片」标签

**Files:**
- Modify: `src/lib/project/view.ts`、`src/lib/project/load.ts`、`src/components/project/project-workspace.tsx`、`src/lib/agent/context.ts`、`src/app/page.tsx`
- Create: `src/components/project/film-pane.tsx`
- Test: `tests/lib/project/view.test.ts`（追加）、`tests/components/film-pane.test.tsx`

**Interfaces:**
- Consumes: Task 4、6 的数据形状；`uploadVideo` 的写法（阶段 3 `upload.ts`）作参考。
- Produces:
  - `interface MaterialView { id: string; url: string; mediaType: 'image' | 'video'; note: string; originalName: string; durationSec: number | null }`、`toMaterialView(projectId, f): MaterialView`
  - `interface FilmView { id: string; version: number; url: string; createdAt: string; summary: string; usage: { materialName: string; atSec: number; durSec: number; clipFromSec?: number; clipToSec?: number; speed?: number }[] }`、`toFilmView(projectId, f, materials: MaterialView[]): FilmView`
  - `ProjectBundle` 新增 `materials: MaterialView[]`、`films: FilmView[]`（新→旧）
  - `FilmPane({ projectId: string; materials: MaterialView[]; films: FilmView[]; onChanged(): void })`
  - 工作区第三个标签 `③ 成片`；`stage === 'final'` 时默认进该标签
  - 阶段文案：`final` → 编导上下文「已出成片」、首页「已出成片」

- [ ] **Step 1: 追加失败测试**

`tests/lib/project/view.test.ts` 末尾追加：

```ts
import { toMaterialView, toFilmView } from '@/lib/project/view';

describe('material / film views', () => {
  const mat = toMaterialView('p1', { id: 'fm', path: '/x/material-1.mov', meta: { note: '放这', originalName: 'rec.mov', mediaType: 'video', durationSec: 40 } });
  it('builds a material view with a file url', () => {
    expect(mat).toEqual({ id: 'fm', url: '/api/projects/p1/files/fm', mediaType: 'video', note: '放这', originalName: 'rec.mov', durationSec: 40 });
  });
  it('resolves material names in the usage table', () => {
    const film = toFilmView(
      'p1',
      { id: 'ff', path: '/x/final.v2.mp4', createdAt: new Date('2026-09-28T01:00:00Z'), meta: { filmVersion: 2, summary: '首版', usage: [{ materialId: 'fm', atSec: 5, durSec: 7, speed: 1.5 }, { materialId: 'gone', atSec: 12, durSec: 3 }] } },
      [mat],
    );
    expect(film).toMatchObject({ version: 2, url: '/api/projects/p1/files/ff', summary: '首版' });
    expect(film.usage).toEqual([
      { materialName: 'rec.mov', atSec: 5, durSec: 7, speed: 1.5 },
      { materialName: '（已删除的素材）', atSec: 12, durSec: 3 },
    ]);
  });
});
```

`tests/components/film-pane.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FilmPane } from '@/components/project/film-pane';

afterEach(cleanup);
const materials = [{ id: 'fm', url: '/api/projects/p1/files/fm', mediaType: 'video' as const, note: '讲安装那段', originalName: 'rec.mov', durationSec: 40 }];

describe('FilmPane', () => {
  it('explains how to get a film when there is none yet', () => {
    render(<FilmPane projectId="p1" materials={[]} films={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('还没有成片。在 Claude Code 里说「给这个项目出片」，出好的成片会出现在这里。')).toBeTruthy();
    expect(screen.getByText('把录屏、视频、截图、图片拖到这里，或点击选择')).toBeTruthy();
  });
  it('lists materials with their notes', () => {
    render(<FilmPane projectId="p1" materials={materials} films={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('rec.mov')).toBeTruthy();
    expect(screen.getByDisplayValue('讲安装那段')).toBeTruthy();
  });
  it('shows films newest first with summary and usage table', () => {
    const films = [
      { id: 'f2', version: 2, url: '/f2', createdAt: '2026-09-28T02:00:00Z', summary: '冷知识段换成录屏', usage: [{ materialName: 'rec.mov', atSec: 35, durSec: 8, clipFromSec: 10, clipToSec: 22, speed: 1.5 }] },
      { id: 'f1', version: 1, url: '/f1', createdAt: '2026-09-28T01:00:00Z', summary: '首版', usage: [] },
    ];
    render(<FilmPane projectId="p1" materials={materials} films={films} onChanged={vi.fn()} />);
    const titles = screen.getAllByText(/^成片 v\d$/).map((e) => e.textContent);
    expect(titles).toEqual(['成片 v2', '成片 v1']);
    expect(screen.getByText('冷知识段换成录屏')).toBeTruthy();
    expect(screen.getByText('0:35 起 8 秒 · rec.mov 0:10–0:22 · 1.5 倍速')).toBeTruthy();
    expect(screen.getByText('修改成片：在 Claude Code 里说「改这个项目的成片：……」')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/project tests/components/film-pane.test.tsx`
Expected: FAIL（`toMaterialView` 未导出；`film-pane` 不存在）。

- [ ] **Step 3: `src/lib/project/view.ts` 追加**

```ts
export interface MaterialView {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  note: string;
  originalName: string;
  durationSec: number | null;
}

export function toMaterialView(projectId: string, f: { id: string; path: string; meta: unknown }): MaterialView {
  const m = (f.meta ?? {}) as { note?: unknown; originalName?: unknown; mediaType?: unknown; durationSec?: unknown };
  return {
    id: f.id,
    url: `/api/projects/${projectId}/files/${f.id}`,
    mediaType: m.mediaType === 'video' ? 'video' : 'image',
    note: typeof m.note === 'string' ? m.note : '',
    originalName: typeof m.originalName === 'string' ? m.originalName : f.path.split('/').pop() ?? '',
    durationSec: typeof m.durationSec === 'number' ? m.durationSec : null,
  };
}

export interface FilmView {
  id: string;
  version: number;
  url: string;
  createdAt: string;
  summary: string;
  usage: { materialName: string; atSec: number; durSec: number; clipFromSec?: number; clipToSec?: number; speed?: number }[];
}

type UsageRow = { materialId: string; atSec: number; durSec: number; clipFromSec?: number; clipToSec?: number; speed?: number };

export function toFilmView(projectId: string, f: { id: string; path: string; createdAt: Date; meta: unknown }, materials: MaterialView[]): FilmView {
  const m = (f.meta ?? {}) as { filmVersion?: unknown; summary?: unknown; usage?: unknown };
  const usage = (Array.isArray(m.usage) ? (m.usage as UsageRow[]) : []).map(({ materialId, ...rest }) => ({
    materialName: materials.find((x) => x.id === materialId)?.originalName ?? '（已删除的素材）',
    ...rest,
  }));
  return {
    id: f.id,
    version: Number(m.filmVersion) || 0,
    url: `/api/projects/${projectId}/files/${f.id}`,
    createdAt: f.createdAt.toISOString(),
    summary: typeof m.summary === 'string' ? m.summary : '',
    usage,
  };
}
```

- [ ] **Step 4: `src/lib/project/load.ts`**

`ProjectBundle` 接口追加 `materials: MaterialView[];` 与 `films: FilmView[];`（并从 `./view` 引入 `toMaterialView, toFilmView, type MaterialView, type FilmView`）。在 `Promise.all` 数组末尾追加两项：

```ts
    db.projectFile.findMany({ where: { projectId: id, kind: 'material' }, orderBy: { createdAt: 'asc' } }),
    db.projectFile.findMany({ where: { projectId: id, kind: 'final_mp4' }, orderBy: { createdAt: 'desc' } }),
```

解构对应改为 `const [messages, video, transcript, jobs, materialRows, filmRows] = await Promise.all([...])`，返回对象追加：

```ts
    materials: materialRows.map((f) => toMaterialView(id, f)),
    films: filmRows.map((f) => toFilmView(id, f, materialRows.map((m) => toMaterialView(id, m)))),
```

- [ ] **Step 5: `src/components/project/film-pane.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import type { FilmView, MaterialView } from '@/lib/project/view';
import { cn } from '@/lib/utils';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function usageText(u: FilmView['usage'][number]): string {
  const clip = u.clipFromSec !== undefined && u.clipToSec !== undefined ? ` ${mmss(u.clipFromSec)}–${mmss(u.clipToSec)}` : '';
  const speed = u.speed && u.speed !== 1 ? ` · ${u.speed} 倍速` : '';
  return `${mmss(u.atSec)} 起 ${u.durSec} 秒 · ${u.materialName}${clip}${speed}`;
}

function uploadMaterial(projectId: string, file: File, note: string, onProgress: (r: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/projects/${projectId}/materials`);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-note', encodeURIComponent(note));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { success?: boolean; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // 非 JSON 响应按失败处理
      }
      resolve(body.success ? null : body.message ?? `上传失败（${xhr.status}）`);
    };
    xhr.onerror = () => resolve('网络断了，上传没完成。重新拖进来再传一次。');
    xhr.send(file);
  });
}

export function FilmPane({ projectId, materials, films, onChanged }: { projectId: string; materials: MaterialView[]; films: FilmView[]; onChanged: () => void }) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(list: FileList | null) {
    if (!list || list.length === 0 || uploading !== null) return;
    setError(null);
    for (const file of Array.from(list)) {
      setUploading(0);
      const err = await uploadMaterial(projectId, file, '', setUploading);
      if (err) setError(`${file.name}：${err}`);
    }
    setUploading(null);
    onChanged();
  }

  async function saveNote(id: string, note: string) {
    const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
    const j = await res.json();
    if (!j.success) setError(j.message);
  }

  async function remove(id: string) {
    const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (!j.success) setError(j.message);
    onChanged();
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <section>
        <h3 className="mb-2 text-sm font-medium">素材</h3>
        <div
          className={cn(
            'mb-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed p-5 text-sm',
            dragging ? 'border-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          )}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void send(e.dataTransfer.files);
          }}
        >
          {uploading !== null ? `上传中… ${Math.round(uploading * 100)}%` : '把录屏、视频、截图、图片拖到这里，或点击选择'}
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.m4v" className="hidden" onChange={(e) => void send(e.target.files)} />
        </div>
        {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
        <ul className="space-y-2">
          {materials.map((m) => (
            <li key={m.id} className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
              {m.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
              ) : (
                <video src={m.url} preload="metadata" muted className="h-16 w-24 shrink-0 rounded bg-black object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="truncate">{m.originalName}</span>
                  {m.durationSec !== null && <span className="font-mono">{mmss(m.durationSec)}</span>}
                  <div className="flex-1" />
                  <button className="text-[var(--danger)]" onClick={() => void remove(m.id)}>
                    删除
                  </button>
                </div>
                <input
                  className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-sm"
                  placeholder="一句说明（可不写），比如：讲安装那段，用 0:10～0:40"
                  defaultValue={m.note}
                  onBlur={(e) => e.target.value !== m.note && void saveNote(m.id, e.target.value)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">成片</h3>
        {films.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">还没有成片。在 Claude Code 里说「给这个项目出片」，出好的成片会出现在这里。</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-[var(--text-tertiary)]">修改成片：在 Claude Code 里说「改这个项目的成片：……」</p>
            <ul className="space-y-4">
              {films.map((f) => (
                <li key={f.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-2 flex items-center gap-3 text-sm">
                    <b>{`成片 v${f.version}`}</b>
                    <span className="text-xs text-[var(--text-tertiary)]">{new Date(f.createdAt).toLocaleString('zh-CN')}</span>
                    <div className="flex-1" />
                    <a className="text-xs text-[var(--accent)]" href={f.url} download={`成片v${f.version}.mp4`}>
                      下载
                    </a>
                  </div>
                  {f.summary && <p className="mb-2 text-sm text-[var(--text-secondary)]">{f.summary}</p>}
                  <video src={f.url} controls className="mb-2 max-h-[60vh] rounded bg-black" />
                  {f.usage.length > 0 && (
                    <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                      {f.usage.map((u, i) => (
                        <li key={i} className="font-mono">
                          {usageText(u)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: 工作区第三个标签（`src/components/project/project-workspace.tsx`）**

(a) import 追加 `import { FilmPane } from './film-pane';`，类型 import 追加 `FilmView, MaterialView`。
(b) `type Tab = 'script' | 'recording' | 'film';`，`TABS` 追加 `{ key: 'film', label: '③ 成片' }`。
(c) props 追加 `initialMaterials = []`、`initialFilms = []`（类型 `MaterialView[]`、`FilmView[]`，可选）；state 追加 `const [materials, setMaterials] = useState(initialMaterials); const [films, setFilms] = useState(initialFilms);`。
(d) 初始标签改为：`useState<Tab>(initialProject.stage === 'draft' ? 'script' : initialProject.stage === 'final' ? 'film' : 'recording')`。
(e) `refresh` 里追加 `setMaterials(j.data.materials ?? []); setFilms(j.data.films ?? []);`。
(f) 内容区三元改为按 `tab` 选择：`script` → `ScriptPane`，`recording` → `RecordingPane`，`film` → `<FilmPane projectId={project.id} materials={materials} films={films} onChanged={() => void refresh()} />`。

`src/app/projects/[id]/page.tsx` 给 `ProjectWorkspace` 追加 `initialMaterials={bundle.materials}`、`initialFilms={bundle.films}`。

- [ ] **Step 7: 阶段文案**

`src/lib/agent/context.ts` 的 `STAGE_LABEL` 追加 `final: '已出成片'`；`src/app/page.tsx` 的 `STAGE_TEXT` 追加 `final: '已出成片'`。

- [ ] **Step 8: 测试 + 类型检查**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误（工作区既有测试不受影响：初始 stage 为 draft）。

- [ ] **Step 9: 真机检查**

打开验收项目 → 「③ 成片」：看到 Task 6 冒烟上传的截图素材与说明；拖入一个 mp4（`~/mediapilot-archive/video-productions/f125c260-433/source.mov` 截 10 秒：`ffmpeg -y -i <它> -t 10 -c copy /tmp/mp-rec.mov`）→ 列表出现视频素材、时长 0:10；改说明后刷新仍在；删除后消失；无成片时显示引导文案。用 DOM 查询（不靠截图）确认。

- [ ] **Step 10: Commit**

```bash
git add src/lib/project src/components/project src/lib/agent/context.ts src/app tests
git commit -m "feat(ui): ③ 成片标签(素材上传与说明/成片版本/素材使用表)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 出片 skill

**Files:**
- Create: `.claude/skills/produce-film/SKILL.md`

- [ ] **Step 1: 写 `.claude/skills/produce-film/SKILL.md`**

````markdown
---
name: produce-film
description: 给 MediaPilot 项目出一条竖屏口播成片(Remotion, 风格 C 极客手账)。触发词:"给 X 项目出片"、"出片"、"改 X 项目的成片"、"重新出一版"。
---

# 出片

画框固定: 1080×1920, 人物小窗右上角全程在, 底部字幕, 中间内容区。你只创作内容区。设计依据: `docs/superpowers/specs/2026-09-28-film-production-design.md`。

## 流程(每一步都要做, 不许跳)

1. **找项目**: `npm run -s mp -- project list`。用户说的项目名对不上就问。
2. **读资料**: `npm run -s mp -- project export <id>`。读稿子、逐句转写、素材说明。
   - 视频素材: `ffmpeg -i <path> -vf fps=1/2,scale=480:-1 /tmp/mat-<id>-%03d.jpg` 抽帧后逐张看; 图片直接看。
3. **建片子**: `npm run -s mp -- film new <id>` → 得到片子目录 `remotion/films/<id>-v<N>/`。
   - 修改旧版时: 建新版本后, 从旧版目录复制 `Film.tsx`、`copy.ts`、`shots.json` 过来再改, 旧版不动。
4. **排镜头表** `shots.json`: 按句子边界切成 2–8 秒的镜头(硬限制 1–12 秒), 首尾相接覆盖 0 到口播结束。每镜 `intent` 写这镜讲什么; 用素材时写 `material: { id, clipFromSec, clipToSec, speed }`。
   - 素材有说明 → 照说明放。没说明 → 看抽帧 + 转写自己判断放哪、截哪段。
   - 视频素材比镜头长: 先加速(≤2 倍), 还放不下就截最相关的一段; 比镜头短: 停在最后一帧或接一张卡。
5. **写画面**:
   - 画面上**所有文字**写进 `copy.ts` 的 `COPY`; `Film.tsx` 里不写字面中文。
   - 只用 `remotion/kit` 的积木(Note、Kicker、Stat、StepList、Marker、Compare、Quote、Arrow、WindowFrame、MediaIn、Shot)与 `kit/motion/anim` 动效; 构图、节奏、积木搭配针对内容自己设计, 不要每镜同一种卡。
   - 数字只能用稿子或转写里出现过的; 没把握的不写数字。
   - 不替用户编经历、案例、效果数据。
   - `Frame` 的 `highlights` 放 1–3 个关键词(字幕荧光笔); `pipFocus` 按人脸位置调(默认 `'50% 20%'`)。
6. **检查**: `npm run -s mp -- film check <片子目录>`。有 ✗ 就改到通过。
7. **看关键帧**: `npm run -s mp -- film render <片子目录> --stills`, 用 Read 逐张看 `stills/*.png`:
   - 小窗里脸完整、没被裁歪; 内容不挤、不溢出、不被裁; 字能读清(手机上看); 中文字体正常;
   - 同一镜的积木对齐、留白舒服; 与上下镜的节奏有变化。
   - 有问题改完重跑第 6、7 步。
8. **渲染成片**: `npm run -s mp -- film render <片子目录>`(80 秒约 <Task 2 实测> 分钟)。
9. **登记**: `npm run -s mp -- film register <片子目录> --summary "<这一版做了什么/改了什么>"`。
10. **告诉用户**: 成片版本号、时长、用了哪些素材放在哪、哪里做了取舍; 请用户在项目页「③ 成片」看片。

## 禁止

- 改 `remotion/kit` 来迁就一条片子(组件问题单独提出来, 用户同意后再改)。
- 在内容区之外放东西; 让素材带声音。
- 跳过第 6、7 步直接渲染成片。
````

- [ ] **Step 2: 把 Task 2 实测的渲染耗时填进第 8 步，提交**

```bash
git add .claude/skills/produce-film/SKILL.md
git commit -m "feat(film): produce-film 出片流程 skill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 真实出片验收 + 文档

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-28-film-production-design.md`（§9 实测）

- [ ] **Step 1: 向用户要一段录屏素材**

请用户提供一段与 U 盘话题相关的录屏（或任意他想放进片子的录屏/视频），上传到验收项目「③ 成片」的素材区，说明可写可不写。用户暂时没有时：用 `~/mediapilot-archive/video-productions/f125c260-433/source.mov` 截取 20 秒作替身，并在 ledger 注明"录屏素材为替身，待用户换真实素材复验"。

- [ ] **Step 2: 按 produce-film skill 完整出一版**

严格按 `.claude/skills/produce-film/SKILL.md` 第 1–10 步执行（这一步就是 skill 的首次真实使用）。记录：镜头数、`film check` 首次问题数与修正、关键帧看图发现的问题与修正、整片渲染耗时、成片时长与大小。

- [ ] **Step 3: 自检成片**

```bash
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact projects/<id>/final.v<N>.mp4
ffmpeg -loglevel error -y -i projects/<id>/final.v<N>.mp4 -vf "fps=1/8,scale=270:-1,tile=5x2" /tmp/mp-final-sheet.png
```
Expected: h264 1080×1920 + aac，时长与原片一致（±0.1 秒）。用 Read 看抽帧拼图：每格都有内容区卡片或素材、小窗人像、字幕。用 SendUserFile 把拼图发给用户，并请用户在项目页播放成片、给出风格意见。

- [ ] **Step 4: 文档**

README「现在能做什么」追加：

```markdown
- **③ 成片**：上传录屏、视频、截图、图片作素材（可写一句说明）；在 Claude Code 里说「给这个项目出片」，按 produce-film 流程用 Remotion 出一条 1080×1920 竖屏成片（人物小窗右上角、内容区动效卡片与素材、底部字幕），登记回项目后可播放、下载、查看素材使用表。
```

README「快速开始」追加 `cd remotion && npm install`（Remotion 子工程依赖），并新增一节：

```markdown
## 出片命令行（给 Claude Code 用）

npm run -s mp -- project list | project export <id> | film new <id> | film check <目录> | film render <目录> [--stills] | film register <目录> --summary <文字>
```

README 删除所有 Overlay Studio 相关内容（若有）。spec §9 写入实测：渲染耗时、首条成片的检查与修正次数。

- [ ] **Step 5: 收尾检查与提交**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git grep -nE "overlay-studio|OverlayArrangement" -- src tests scripts README.md
git status --short
git add README.md docs/superpowers/specs/2026-09-28-film-production-design.md
git commit -m "docs: README 补出片流程与命令行, spec 记录阶段 4 实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 全绿；grep 无输出；`git status` 不含 `remotion/films/`、`projects/`。
