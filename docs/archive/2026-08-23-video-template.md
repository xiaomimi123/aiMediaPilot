# 二十期 · 视频模板板块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增侧栏「模板」板块——把交付模式/画面风格/配音/写稿提示/字幕/BGM/片头片尾固化为可复用模板,出片流程收敛为「选模板 → 定文案 → 自动出片」,并补齐管线缺失的包装能力。

**Architecture:** 模板是**参数预设层**,不新造生成管线——模板页发起的任务展开成现有 `VideoProduction` 参数,复用十九期全部合成能力;在 worker 的 master 渲染之后新增一段**三交付模式共用的包装段**(样式化 `.ass` 字幕 → BGM 混音 → 片头片尾拼接)。

**Tech Stack:** Next.js App Router / Prisma + Postgres / BullMQ worker / ffmpeg(libass) / vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-08-23-video-template-design.md`

## Global Constraints

- **零迁移**:`VideoProduction.templateId` 为 null 时(内容详情页旧入口)所有行为与十九期字符级一致;包装段整段跳过。
- **纯函数 + 集成双层测试**:所有 ffmpeg 能力先写"构造参数数组的纯函数"(`src/lib/video/ffmpeg.ts`,单测)+ 真实 ffmpeg 集成测试(`tests/lib/video-production/*.test.ts`,lavfi 造素材、抽帧验色)。这是十八/十九期既有模式,必须沿用。
- **不用 `-c copy` 拼接非同源素材**:十九期实测有帧边界漂移。片头片尾拼接一律重编码(视频 `libx264` / 音频 `aac`)。
- **交付模式取值**:`ppt-narration` | `talking-head-broll` | `illustration-tts`(见 `src/lib/cockpit/model.ts:116` 的 `DeliveryMode`,`manual` 不是模板的合法值)。
- **六幕 act key 顺序**:`hook, concept_a, concept_b, trivia, synthesis, punchline`(`ACT_KEYS`,`src/lib/script/six-act.ts:15`)。
- **schema 变更后**:主 checkout 必须 `npx prisma generate`,否则 typecheck 爆错(十九期教训)。本项目用 `npm run db:push`(无 migrations 目录)。
- **DB 写 cockpit 数据必须 `bumpCockpitRev(userId)`**(`src/lib/cockpit/server-store.ts:377`),否则前端读到脏缓存。
- **文件名/路径安全**:上传落盘一律走 `safeExt` 白名单式扩展名(范式见 `src/app/api/v1/cockpit/video-productions/[id]/upload-source/route.ts:13`),禁止用用户输入拼路径。
- **测试命令**:单文件 `npx vitest run <path>`;全量 `npx vitest run`;类型 `npx tsc --noEmit`。
- **每个 Task 结束必须**:全量 `npx vitest run` + `npx tsc --noEmit` 全绿,然后 commit。

---

## File Structure

**新建**
| 文件 | 职责 |
|---|---|
| `src/lib/video-production/ass-captions.ts` | `.ass` 字幕生成:样式映射 + 三种时间轴来源转换 |
| `src/lib/video-production/packaging.ts` | 包装段编排:三步串接,唯一消费 worker 的入口 |
| `src/lib/video-template/model.ts` | 模板类型/zod schema/默认值/3 个预设定义 |
| `src/lib/video-template/store.ts` | 模板 CRUD + 播种 + 素材目录管理(服务端) |
| `src/app/api/v1/video-templates/route.ts` | GET 列表(含播种)/ POST 新建 |
| `src/app/api/v1/video-templates/[id]/route.ts` | GET / PUT / DELETE |
| `src/app/api/v1/video-templates/[id]/duplicate/route.ts` | 复制(含素材文件本体) |
| `src/app/api/v1/video-templates/[id]/assets/route.ts` | 素材上传(bgm/intro/outro) |
| `src/app/api/v1/video-templates/[id]/script/route.ts` | 文案生成(粘贴/灵感 → 六幕稿预览,不落库) |
| `src/app/api/v1/video-templates/[id]/produce/route.ts` | 发起出片(必要时自动建内容卡) |
| `src/components/cockpit/views/templates.tsx` | 模板页:列表 + 编辑器 + 出片向导 |

**修改**
| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | 新增 `VideoTemplate` model;`VideoProduction` 加 `templateId String?`;`User` 加反向关系 |
| `src/lib/video/ffmpeg.ts` | 新增 BGM 混音 / 重编码拼接 / 静音轨补齐的参数构造器与执行函数 |
| `src/jobs/workers/video-production-worker.ts` | master 完成后按 templateId 进包装段;带 captionStyle 的真人出镜跳过默认 `.srt` 烧录 |
| `src/lib/llm/prompts/script-write-douyin.ts` | `buildSystemPrompt` 增加可选 templateSection 参数 |
| `src/lib/cockpit/view-routing.ts` | `NavView` 增加 `"templates"` |
| `src/components/cockpit/sidebar.tsx` | 导航项增加「模板」 |
| `src/components/cockpit/Cockpit.tsx` | 挂载 TemplatesView |

**任务依赖顺序**:T1(数据层) → T2/T3/T4(ffmpeg 三件套,可并行) → T5(包装编排) → T6(worker 接线) → T7(模板 CRUD API) → T8(写稿注入) → T9(文案/出片 API) → T10(前端) → T11(E2E 走查与文档)。

---

### Task 1: 数据层 —— VideoTemplate 表 + 类型 + 3 个预设定义

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/video-template/model.ts`
- Test: `tests/lib/video-template/model.test.ts`

**Interfaces:**
- Consumes: `DeliveryMode`(`src/lib/cockpit/model.ts`)
- Produces:
  - `interface VideoTemplateConfig { name: string; description: string; deliveryMode: DeliveryMode; visualStyle: 'card'|'illustration'; palette: string[]|null; voicePreset: { voiceType?: string; resourceId?: string }|null; scriptPrompt: { tone?: string; targetDurationSec?: 30|45|60|90; hookHint?: string; extraGuidance?: string }|null; captionStyle: CaptionStyle|null; bgmPath: string|null; bgmVolume: number; introPath: string|null; outroPath: string|null }`
  - `interface CaptionStyle { fontFamily: string; fontSize: number; primaryColor: string; outlineColor: string; outlineWidth: number; marginV: number }`
  - `const CAPTION_FONT_WHITELIST: readonly string[]`(macOS 自带中文字体)
  - `const VideoTemplateConfigSchema: z.ZodType<VideoTemplateConfig>`
  - `const PRESET_TEMPLATES: readonly VideoTemplateConfig[]`(长度 3)
  - `function defaultCaptionStyle(): CaptionStyle`

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/video-template/model.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  PRESET_TEMPLATES,
  VideoTemplateConfigSchema,
  defaultCaptionStyle,
  CAPTION_FONT_WHITELIST,
} from '@/lib/video-template/model';

describe('PRESET_TEMPLATES', () => {
  it('恰好 3 个预设, 三种交付模式各一个', () => {
    expect(PRESET_TEMPLATES).toHaveLength(3);
    const modes = PRESET_TEMPLATES.map((t) => t.deliveryMode).sort();
    expect(modes).toEqual(['illustration-tts', 'ppt-narration', 'talking-head-broll']);
  });

  it('每个预设都能通过 schema 校验', () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(() => VideoTemplateConfigSchema.parse(preset)).not.toThrow();
    }
  });

  it('预设默认不带 BGM/片头/片尾(素材需用户自己上传)', () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.bgmPath).toBeNull();
      expect(preset.introPath).toBeNull();
      expect(preset.outroPath).toBeNull();
    }
  });

  it('插画预设用 illustration 画面风格并带配音音色预设', () => {
    const illust = PRESET_TEMPLATES.find((t) => t.deliveryMode === 'illustration-tts')!;
    expect(illust.visualStyle).toBe('illustration');
    expect(illust.voicePreset).not.toBeNull();
  });
});

describe('VideoTemplateConfigSchema', () => {
  it('拒绝非法交付模式(manual 不是模板的合法值)', () => {
    const bad = { ...PRESET_TEMPLATES[0], deliveryMode: 'manual' };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });

  it('拒绝白名单外的字幕字体', () => {
    const bad = {
      ...PRESET_TEMPLATES[0],
      captionStyle: { ...defaultCaptionStyle(), fontFamily: 'Comic Sans MS' },
    };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });

  it('拒绝越界的 bgmVolume', () => {
    expect(() => VideoTemplateConfigSchema.parse({ ...PRESET_TEMPLATES[0], bgmVolume: 1.5 })).toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...PRESET_TEMPLATES[0], bgmVolume: -0.1 })).toThrow();
  });

  it('拒绝非 #RRGGBB 的字幕颜色', () => {
    const bad = {
      ...PRESET_TEMPLATES[0],
      captionStyle: { ...defaultCaptionStyle(), primaryColor: 'white' },
    };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });
});

describe('defaultCaptionStyle', () => {
  it('默认字体在白名单内', () => {
    expect(CAPTION_FONT_WHITELIST).toContain(defaultCaptionStyle().fontFamily);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video-template/model.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/video-template/model"`

- [ ] **Step 3: 写实现**

创建 `src/lib/video-template/model.ts`:

```typescript
import { z } from 'zod';
import type { DeliveryMode } from '@/lib/cockpit/model';

/**
 * 字幕字体白名单 —— `.ass` 的字体名必须是渲染机器上真实装了的字体, libass 找不到
 * 会静默回退成默认字体(看起来"样式没生效")。收敛为 macOS 自带中文字体, 不做字体上传
 * (见 spec §7 范围外)。
 */
export const CAPTION_FONT_WHITELIST = [
  'PingFang SC',
  'Hiragino Sans GB',
  'STHeiti',
  'Songti SC',
] as const;

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;  // #RRGGBB
  outlineColor: string;  // #RRGGBB
  outlineWidth: number;
  marginV: number;       // 距画面底部的边距(像素)
}

export interface VideoTemplateConfig {
  name: string;
  description: string;
  deliveryMode: DeliveryMode;
  visualStyle: 'card' | 'illustration';
  palette: string[] | null;
  voicePreset: { voiceType?: string; resourceId?: string } | null;
  scriptPrompt: {
    tone?: string;
    targetDurationSec?: 30 | 45 | 60 | 90;
    hookHint?: string;
    extraGuidance?: string;
  } | null;
  captionStyle: CaptionStyle | null;  // null = 不烧字幕
  bgmPath: string | null;
  bgmVolume: number;                  // 0~1
  introPath: string | null;
  outroPath: string | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const CaptionStyleSchema = z.object({
  fontFamily: z.enum(CAPTION_FONT_WHITELIST),
  fontSize: z.number().int().min(12).max(200),
  primaryColor: z.string().regex(HEX_COLOR),
  outlineColor: z.string().regex(HEX_COLOR),
  outlineWidth: z.number().min(0).max(10),
  marginV: z.number().int().min(0).max(500),
});

export const VideoTemplateConfigSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200),
  // 'manual' 不是模板的合法值 —— 模板一定驱动某条 AI 生成管线
  deliveryMode: z.enum(['ppt-narration', 'talking-head-broll', 'illustration-tts']),
  visualStyle: z.enum(['card', 'illustration']),
  palette: z.array(z.string().regex(HEX_COLOR)).nullable(),
  voicePreset: z.object({ voiceType: z.string().optional(), resourceId: z.string().optional() }).nullable(),
  scriptPrompt: z
    .object({
      tone: z.string().max(100).optional(),
      targetDurationSec: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional(),
      hookHint: z.string().max(200).optional(),
      extraGuidance: z.string().max(500).optional(),
    })
    .nullable(),
  captionStyle: CaptionStyleSchema.nullable(),
  bgmPath: z.string().nullable(),
  bgmVolume: z.number().min(0).max(1),
  introPath: z.string().nullable(),
  outroPath: z.string().nullable(),
}) as unknown as z.ZodType<VideoTemplateConfig>;

export function defaultCaptionStyle(): CaptionStyle {
  return {
    fontFamily: 'PingFang SC',
    fontSize: 56,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    marginV: 90,
  };
}

/**
 * 内置 3 个预设 —— 按三种交付模式各一个(用户 2026-08-23 拍板)。首次进入模板页且
 * 该用户 0 条模板时播种; 播种后与普通模板完全一样, 可改可复制可删。
 * 素材(BGM/片头/片尾)一律为 null: 用户自己上传(spec §2.3)。
 */
export const PRESET_TEMPLATES: readonly VideoTemplateConfig[] = [
  {
    name: '图文口播',
    description: 'AI 分镜卡片串成完整片子, 无需出镜也无需配音',
    deliveryMode: 'ppt-narration',
    visualStyle: 'card',
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
  },
  {
    name: '真人出镜 + B-roll',
    description: '上传自己拍的口播视频, AI 生成 B-roll 挖空替换, 烧录真实原话字幕',
    deliveryMode: 'talking-head-broll',
    visualStyle: 'card',
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.12,
    introPath: null,
    outroPath: null,
  },
  {
    name: '插画配音',
    description: '火山 TTS 逐幕配音驱动插画风分镜, 全自动出片',
    deliveryMode: 'illustration-tts',
    visualStyle: 'illustration',
    palette: null,
    voicePreset: { voiceType: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0' },
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
  },
];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/lib/video-template/model.test.ts`
Expected: PASS(9 个用例)

- [ ] **Step 5: 改 Prisma schema**

在 `prisma/schema.prisma` 的 `VideoProduction` model **之后**插入:

```prisma
model VideoTemplate {
  id           String  @id
  userId       String
  name         String
  description  String  @default("")
  deliveryMode String  // ppt-narration|talking-head-broll|illustration-tts
  visualStyle  String  @default("card") // card|illustration
  palette      Json?
  voicePreset  Json?   // { voiceType?, resourceId? } — 仅 illustration-tts 消费
  scriptPrompt Json?   // { tone?, targetDurationSec?, hookHint?, extraGuidance? }
  captionStyle Json?   // null = 不烧字幕
  bgmPath      String?
  bgmVolume    Float   @default(0.15)
  introPath    String?
  outroPath    String?
  isPreset     Boolean @default(false)
  createdAt    String
  updatedAt    String
  user         User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

在 `VideoProduction` model 里 `masterPath` 之后加一行:

```prisma
  templateId      String? // 二十期: 由哪个模板发起; null = 内容详情页旧入口, 包装段整段跳过
```

在 `User` model 的关系区加一行(与 `videoProductions` 等既有反向关系放在一起):

```prisma
  videoTemplates VideoTemplate[]
```

- [ ] **Step 6: 同步 DB 并重新生成 client**

Run: `npm run db:push && npx prisma generate`
Expected: 成功,无报错。然后 `npx tsc --noEmit` 全绿。

- [ ] **Step 7: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿

```bash
git add prisma/schema.prisma src/lib/video-template/model.ts tests/lib/video-template/model.test.ts
git commit -m "feat(video-template): 二十期 — VideoTemplate 数据模型 + 3 个内置预设定义"
```

---

### Task 2: `.ass` 字幕生成器

**Files:**
- Create: `src/lib/video-production/ass-captions.ts`
- Test: `tests/lib/video-production/ass-captions.test.ts`

**Interfaces:**
- Consumes: `CaptionStyle`(Task 1)、`ScriptAct`/`ACT_KEYS`(`src/lib/script/six-act.ts`)、`AlignedAct`(`src/lib/video-production/aligner-prompt.ts`)、`TranscriptSegment`(`src/lib/llm/whisper.ts`,形状 `{ start: number; end: number; text: string }`,单位秒)
- Produces:
  - `function hexToAssColor(hex: string): string` — `#RRGGBB` → `&H00BBGGRR`
  - `function formatAssTimestamp(ms: number): string` — `H:MM:SS.cc`
  - `function buildAssCaptions(events: CaptionEvent[], style: CaptionStyle): string`
  - `interface CaptionEvent { startMs: number; endMs: number; text: string }`
  - `function captionEventsFromTranscript(segments: TranscriptSegment[]): CaptionEvent[]`
  - `function captionEventsFromAlignedActs(aligned: AlignedAct[], narrations: Record<string, string>): CaptionEvent[]`

**背景**:`AlignedAct` 形状是 `{ act: ActKey; startMs: number; endMs: number }`(见 `aligner-prompt.ts:6`);`TranscriptSegment` 的 `start`/`end` 是**秒**(与 `buildCaptionSrtFromTranscript` 同源,见 `srt-synthesis.ts:116`)。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/video-production/ass-captions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  hexToAssColor,
  formatAssTimestamp,
  buildAssCaptions,
  captionEventsFromTranscript,
  captionEventsFromAlignedActs,
} from '@/lib/video-production/ass-captions';
import { defaultCaptionStyle } from '@/lib/video-template/model';

describe('hexToAssColor', () => {
  it('#RRGGBB 转成 ASS 的 &H00BBGGRR (BGR 逆序)', () => {
    expect(hexToAssColor('#FFFFFF')).toBe('&H00FFFFFF');
    expect(hexToAssColor('#FF0000')).toBe('&H000000FF'); // 纯红: R=FF 落在最后两位
    expect(hexToAssColor('#00FF00')).toBe('&H0000FF00');
    expect(hexToAssColor('#123456')).toBe('&H00563412');
  });

  it('小写十六进制也能转', () => {
    expect(hexToAssColor('#abcdef')).toBe('&H00EFCDAB');
  });
});

describe('formatAssTimestamp', () => {
  it('毫秒转 H:MM:SS.cc (百分秒)', () => {
    expect(formatAssTimestamp(0)).toBe('0:00:00.00');
    expect(formatAssTimestamp(1500)).toBe('0:00:01.50');
    expect(formatAssTimestamp(61230)).toBe('0:01:01.23');
    expect(formatAssTimestamp(3661000)).toBe('1:01:01.00');
  });
});

describe('buildAssCaptions', () => {
  const style = defaultCaptionStyle();

  it('产出含 Script Info / V4+ Styles / Events 三段的合法 .ass', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: '测试字幕' }], style);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Dialogue: ');
  });

  it('样式字段写进 Style 行: 字体/字号/主色/描边色/描边宽/底边距', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: 'x' }], {
      fontFamily: 'PingFang SC',
      fontSize: 48,
      primaryColor: '#FF0000',
      outlineColor: '#000000',
      outlineWidth: 2,
      marginV: 80,
    });
    const styleLine = ass.split('\n').find((l) => l.startsWith('Style: '))!;
    expect(styleLine).toContain('PingFang SC');
    expect(styleLine).toContain('48');
    expect(styleLine).toContain('&H000000FF'); // 主色 红
    expect(styleLine).toContain('&H00000000'); // 描边色 黑
    expect(styleLine).toContain('80');         // marginV
  });

  it('每个事件一行 Dialogue, 时间戳正确', () => {
    const ass = buildAssCaptions(
      [
        { startMs: 0, endMs: 1500, text: '第一句' },
        { startMs: 1500, endMs: 3000, text: '第二句' },
      ],
      style,
    );
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '));
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toContain('0:00:00.00');
    expect(dialogues[0]).toContain('0:00:01.50');
    expect(dialogues[0]).toContain('第一句');
    expect(dialogues[1]).toContain('第二句');
  });

  it('文本里的换行转成 ASS 的 \\N, 不破坏 Dialogue 行结构', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: '上一行\n下一行' }], style);
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '));
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toContain('上一行\\N下一行');
  });

  it('零事件时仍产出合法头部(不抛错)', () => {
    const ass = buildAssCaptions([], style);
    expect(ass).toContain('[Events]');
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue: '))).toHaveLength(0);
  });
});

describe('captionEventsFromTranscript', () => {
  it('ASR segments 的秒转毫秒, 文本原样(真人出镜=真实原话)', () => {
    const events = captionEventsFromTranscript([
      { start: 0, end: 1.5, text: ' 大家看这个 ' },
      { start: 1.5, end: 3.25, text: '其实不对' },
    ] as any);
    expect(events).toEqual([
      { startMs: 0, endMs: 1500, text: '大家看这个' },
      { startMs: 1500, endMs: 3250, text: '其实不对' },
    ]);
  });

  it('丢弃空文本 segment', () => {
    const events = captionEventsFromTranscript([
      { start: 0, end: 1, text: '   ' },
      { start: 1, end: 2, text: '有内容' },
    ] as any);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('有内容');
  });
});

describe('captionEventsFromAlignedActs', () => {
  it('按幕边界铺文案, 一幕一条事件', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'hook', startMs: 0, endMs: 2000 },
        { act: 'concept_a', startMs: 2000, endMs: 5000 },
      ] as any,
      { hook: '钩子台词', concept_a: '概念A台词' },
    );
    expect(events).toEqual([
      { startMs: 0, endMs: 2000, text: '钩子台词' },
      { startMs: 2000, endMs: 5000, text: '概念A台词' },
    ]);
  });

  it('缺失 narration 的幕被跳过而不是产出 undefined 文本', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'hook', startMs: 0, endMs: 2000 },
        { act: 'trivia', startMs: 2000, endMs: 4000 },
      ] as any,
      { hook: '有台词' },
    );
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('有台词');
  });

  it('乱序输入按 startMs 排序后输出', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'concept_a', startMs: 2000, endMs: 5000 },
        { act: 'hook', startMs: 0, endMs: 2000 },
      ] as any,
      { hook: 'A', concept_a: 'B' },
    );
    expect(events.map((e) => e.text)).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video-production/ass-captions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/video-production/ass-captions"`

- [ ] **Step 3: 写实现**

创建 `src/lib/video-production/ass-captions.ts`:

```typescript
import type { CaptionStyle } from '@/lib/video-template/model';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * `#RRGGBB` → ASS 的 `&HAABBGGRR`。ASS 颜色是 **BGR 逆序**且带 alpha 前缀
 * (00 = 完全不透明), 直接把 CSS 十六进制丢进去会红蓝对调。
 */
export function hexToAssColor(hex: string): string {
  const v = hex.replace('#', '').toUpperCase();
  const r = v.slice(0, 2);
  const g = v.slice(2, 4);
  const b = v.slice(4, 6);
  return `&H00${b}${g}${r}`;
}

/** 毫秒 → ASS 时间戳 `H:MM:SS.cc` (百分秒, 不是毫秒 —— 与 SRT 的 `HH:MM:SS,mmm` 不同)。 */
export function formatAssTimestamp(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * 生成 `.ass` 字幕文件内容。选 ASS 而非 SRT 是因为样式(字体/字号/颜色/描边/边距)
 * 要能按模板配置, SRT 本身不带样式信息 —— libass 是 ffmpeg subtitles filter 现成
 * 支持的能力, 不引新依赖(spec §3.2)。
 * Alignment=2 是底部居中。
 */
export function buildAssCaptions(events: CaptionEvent[], style: CaptionStyle): string {
  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${style.fontSize},${hexToAssColor(style.primaryColor)},&H000000FF,${hexToAssColor(style.outlineColor)},&H00000000,0,0,0,0,100,100,0,0,1,${style.outlineWidth},0,2,40,40,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogues = events.map((e) => {
    // ASS 的 Dialogue 是单行记录, 文本里的换行必须写成 \N 转义, 否则会把一条事件
    // 撕成两行、后半行不是合法记录直接被 libass 丢弃。
    const text = e.text.replace(/\r?\n/g, '\\N');
    return `Dialogue: 0,${formatAssTimestamp(e.startMs)},${formatAssTimestamp(e.endMs)},Default,,0,0,0,,${text}`;
  });

  return `${header}\n${dialogues.join('\n')}\n`;
}

/**
 * 真人出镜模式的字幕事件源 —— ASR 转写的真实原话(不是脚本台词, 用户实际念的可能
 * 与稿子有出入)。TranscriptSegment 的 start/end 单位是**秒**。
 */
export function captionEventsFromTranscript(segments: TranscriptSegment[]): CaptionEvent[] {
  return segments
    .map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }))
    .filter((e) => e.text.length > 0);
}

/**
 * 插画 TTS / 图文口播模式的字幕事件源 —— 按对齐后的幕边界把该幕台词整段铺上去。
 * 缺 narration 的幕直接跳过(而不是产出 "undefined" 文本 —— 十九期
 * buildSrtFromAlignedActs 踩过这个坑)。
 */
export function captionEventsFromAlignedActs(
  aligned: AlignedAct[],
  narrations: Record<string, string>,
): CaptionEvent[] {
  return [...aligned]
    .sort((a, b) => a.startMs - b.startMs)
    .map((a) => ({ startMs: a.startMs, endMs: a.endMs, text: (narrations[a.act] ?? '').trim() }))
    .filter((e) => e.text.length > 0);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/lib/video-production/ass-captions.test.ts`
Expected: PASS(14 个用例)

- [ ] **Step 5: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/video-production/ass-captions.ts tests/lib/video-production/ass-captions.test.ts
git commit -m "feat(video-production): 二十期 — .ass 样式化字幕生成器(三种时间轴来源)"
```

---

### Task 3: ffmpeg BGM 混音

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`
- Test: `tests/lib/video/ffmpeg.test.ts`(追加 describe)、`tests/lib/video-production/bgm-mix.test.ts`(新建,真实 ffmpeg)

**Interfaces:**
- Produces:
  - `interface MixBgmOpts { videoPath: string; bgmPath: string; bgmVolume: number; outputPath: string; hasVoiceTrack: boolean }`
  - `function buildMixBgmArgs(opts: MixBgmOpts): string[]`
  - `async function mixBgm(opts: Omit<MixBgmOpts, 'hasVoiceTrack'>): Promise<void>` — 内部 probe 判断有无音轨
  - `async function hasAudioStream(videoPath: string): Promise<boolean>`
  - `function buildProbeAudioStreamArgs(videoPath: string): string[]`
  - `function parseHasAudioStream(stdout: string): boolean`

- [ ] **Step 1: 写失败的纯函数测试**

在 `tests/lib/video/ffmpeg.test.ts` 顶部 import 里加入 `buildMixBgmArgs, buildProbeAudioStreamArgs, parseHasAudioStream`,并在 `describe('buildMuxAudioArgs', ...)` 之后追加:

```typescript
describe('buildProbeAudioStreamArgs / parseHasAudioStream', () => {
  it('构造只查音频流的 ffprobe 参数', () => {
    const args = buildProbeAudioStreamArgs('/tmp/v.mp4');
    expect(args).toContain('-select_streams');
    expect(args).toContain('a');
    expect(args).toContain('/tmp/v.mp4');
  });

  it('有音频流 → true', () => {
    expect(parseHasAudioStream(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toBe(true);
  });

  it('无音频流 → false', () => {
    expect(parseHasAudioStream(JSON.stringify({ streams: [] }))).toBe(false);
  });

  it('streams 字段缺失 → false(不抛错)', () => {
    expect(parseHasAudioStream('{}')).toBe(false);
  });
});

describe('buildMixBgmArgs', () => {
  it('有人声时: BGM 循环+压低音量后与人声 amix, 时长以人声为准', () => {
    const args = buildMixBgmArgs({
      videoPath: '/tmp/in.mp4',
      bgmPath: '/tmp/bgm.mp3',
      bgmVolume: 0.15,
      outputPath: '/tmp/out.mp4',
      hasVoiceTrack: true,
    });
    // BGM 输入必须循环补齐(BGM 通常比正片短)
    expect(args).toContain('-stream_loop');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('volume=0.15');
    expect(filter).toContain('amix');
    // duration=first: 以第一路(人声)为准, 不被循环的 BGM 拖长
    expect(filter).toContain('duration=first');
    expect(args).toContain('-c:v');
    expect(args).toContain('copy'); // 画面不重编码
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('无人声时: BGM 即唯一音轨, 不用 amix, 用 -shortest 对齐画面时长', () => {
    const args = buildMixBgmArgs({
      videoPath: '/tmp/in.mp4',
      bgmPath: '/tmp/bgm.mp3',
      bgmVolume: 0.3,
      outputPath: '/tmp/out.mp4',
      hasVoiceTrack: false,
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('volume=0.3');
    expect(filter).not.toContain('amix');
    expect(args).toContain('-shortest');
    expect(args).toContain('-stream_loop');
  });

  it('画面流始终来自第一个输入(0:v)', () => {
    const args = buildMixBgmArgs({
      videoPath: '/tmp/in.mp4',
      bgmPath: '/tmp/bgm.mp3',
      bgmVolume: 0.15,
      outputPath: '/tmp/out.mp4',
      hasVoiceTrack: true,
    });
    expect(args).toContain('0:v:0');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video/ffmpeg.test.ts`
Expected: FAIL — `buildMixBgmArgs is not exported` / 相关导入报错

- [ ] **Step 3: 写实现**

在 `src/lib/video/ffmpeg.ts` 末尾追加:

```typescript
export function buildProbeAudioStreamArgs(videoPath: string): string[] {
  return ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'json', videoPath];
}

export function parseHasAudioStream(stdout: string): boolean {
  try {
    const json = JSON.parse(stdout);
    return Array.isArray(json?.streams) && json.streams.length > 0;
  } catch {
    return false;
  }
}

/** 探测视频是否带音轨 —— 决定 BGM 是与人声 amix 还是直接作为唯一音轨。 */
export async function hasAudioStream(videoPath: string): Promise<boolean> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, buildProbeAudioStreamArgs(videoPath), { timeout: 30_000 });
  return parseHasAudioStream(stdout);
}

export interface MixBgmOpts {
  videoPath: string;
  bgmPath: string;
  bgmVolume: number; // 0~1, BGM 相对音量
  outputPath: string;
  hasVoiceTrack: boolean; // 正片是否已有人声音轨(由 hasAudioStream 探测)
}

/**
 * BGM 混音。BGM 素材通常比正片短, 用 `-stream_loop -1` 无限循环该输入补齐;
 * 长度靠 amix 的 `duration=first`(以人声为准)或 `-shortest`(无人声时以画面为准)收敛,
 * 不需要提前知道 BGM 实际时长。画面 `-c:v copy` 不重编码(混音不动画面, 省一次转码)。
 * v1 用固定音量不做 sidechain 自动闪避(spec §3.3: 效果可预期, 闪避列为后续可选)。
 */
export function buildMixBgmArgs(opts: MixBgmOpts): string[] {
  const filter = opts.hasVoiceTrack
    ? `[1:a]volume=${opts.bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[outa]`
    : `[1:a]volume=${opts.bgmVolume}[outa]`;

  return [
    '-y',
    '-i', opts.videoPath,
    '-stream_loop', '-1', '-i', opts.bgmPath,
    '-filter_complex', filter,
    '-map', '0:v:0',
    '-map', '[outa]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    ...(opts.hasVoiceTrack ? [] : ['-shortest']),
    opts.outputPath,
  ];
}

export async function mixBgm(opts: Omit<MixBgmOpts, 'hasVoiceTrack'>): Promise<void> {
  const hasVoiceTrack = await hasAudioStream(opts.videoPath);
  await execFileAsync(FFMPEG_BIN, buildMixBgmArgs({ ...opts, hasVoiceTrack }), { timeout: 600_000 });
}
```

- [ ] **Step 4: 运行纯函数测试确认通过**

Run: `npx vitest run tests/lib/video/ffmpeg.test.ts`
Expected: PASS

- [ ] **Step 5: 写真实 ffmpeg 集成测试**

创建 `tests/lib/video-production/bgm-mix.test.ts`:

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mixBgm, probeVideo, hasAudioStream } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

describe('mixBgm', () => {
  let workDir: string;
  let videoWithVoice: string;
  let videoSilent: string;
  let shortBgm: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-mix-'));
    videoWithVoice = path.join(workDir, 'with-voice.mp4');
    videoSilent = path.join(workDir, 'silent.mp4');
    shortBgm = path.join(workDir, 'bgm.mp3');

    // 4 秒带"人声"(1000Hz 正弦)的正片
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=4:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', videoWithVoice,
    ], { timeout: 60_000 });

    // 4 秒无音轨的正片(图文口播模式的形状)
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=green:s=320x180:d=4:r=15', '-c:v', 'libx264', '-an', videoSilent,
    ], { timeout: 60_000 });

    // 1 秒 BGM —— 故意比正片短, 验证 -stream_loop 循环补齐
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', shortBgm,
    ], { timeout: 60_000 });
  }, 120_000);

  it('正片有人声: 混音后仍是一条音轨, 总时长不被短 BGM 截断也不被循环拖长', async () => {
    const outputPath = path.join(workDir, 'out-voice.mp4');
    await mixBgm({ videoPath: videoWithVoice, bgmPath: shortBgm, bgmVolume: 0.15, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);

    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', outputPath]);
    const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>;
    expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);
    expect(streams.some((s) => s.codec_type === 'video')).toBe(true);
  }, 120_000);

  it('正片无音轨: BGM 成为唯一音轨, 时长以画面为准', async () => {
    const outputPath = path.join(workDir, 'out-silent.mp4');
    expect(await hasAudioStream(videoSilent)).toBe(false);

    await mixBgm({ videoPath: videoSilent, bgmPath: shortBgm, bgmVolume: 0.3, outputPath });

    expect(await hasAudioStream(outputPath)).toBe(true);
    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);
  }, 120_000);
});
```

- [ ] **Step 6: 运行集成测试确认通过**

Run: `npx vitest run tests/lib/video-production/bgm-mix.test.ts`
Expected: PASS(2 个用例)

- [ ] **Step 7: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/video/ffmpeg.ts tests/lib/video/ffmpeg.test.ts tests/lib/video-production/bgm-mix.test.ts
git commit -m "feat(video): 二十期 — BGM 混音(循环补齐+音量压低+有无人声两分支)"
```

---

### Task 4: ffmpeg 片头/片尾拼接(重编码 + 尺寸对齐 + 静音轨补齐)

**Files:**
- Modify: `src/lib/video/ffmpeg.ts`
- Test: `tests/lib/video/ffmpeg.test.ts`(追加)、`tests/lib/video-production/intro-outro.test.ts`(新建,真实 ffmpeg)

**Interfaces:**
- Consumes: `probeVideoDimensions`(已有)、`hasAudioStream`(Task 3)
- Produces:
  - `interface ConcatWithReencodeOpts { videoPaths: string[]; targetWidth: number; targetHeight: number; outputPath: string }`
  - `function buildConcatWithReencodeArgs(opts: ConcatWithReencodeOpts): string[]`
  - `interface AttachIntroOutroOpts { videoPath: string; introPath?: string|null; outroPath?: string|null; outputPath: string }`
  - `async function attachIntroOutro(opts: AttachIntroOutroOpts): Promise<void>`

**背景**:concat filter 要求所有输入流尺寸/SAR 一致(十九期踩过 2160x3840 vs 1920x1080 崩溃);无音轨的片段参与 `concat=a=1` 会直接失败,必须用 `anullsrc` 补静音。

- [ ] **Step 1: 写失败的纯函数测试**

在 `tests/lib/video/ffmpeg.test.ts` 的 import 加入 `buildConcatWithReencodeArgs`,并追加:

```typescript
describe('buildConcatWithReencodeArgs', () => {
  it('每个输入都 scale+pad 到目标尺寸, 用 concat filter 而非 -c copy', () => {
    const args = buildConcatWithReencodeArgs({
      videoPaths: ['/tmp/intro.mp4', '/tmp/main.mp4'],
      targetWidth: 1080,
      targetHeight: 1920,
      outputPath: '/tmp/out.mp4',
    });
    expect(args).not.toContain('copy');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1080:1920');
    expect(filter).toContain('concat=n=2:v=1:a=1');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
  });

  it('每个输入都补一路静音轨兜底, 避免无声片段让 concat a=1 失败', () => {
    const args = buildConcatWithReencodeArgs({
      videoPaths: ['/tmp/a.mp4', '/tmp/b.mp4'],
      targetWidth: 1920,
      targetHeight: 1080,
      outputPath: '/tmp/out.mp4',
    });
    // 每个输入后面都跟一路 anullsrc 输入, 用 amix 与真实音轨合并(无音轨时即静音)
    const anullCount = args.filter((a) => typeof a === 'string' && a.includes('anullsrc')).length;
    expect(anullCount).toBe(2);
  });

  it('单个输入也能正常构造(concat=n=1)', () => {
    const args = buildConcatWithReencodeArgs({
      videoPaths: ['/tmp/only.mp4'],
      targetWidth: 1920,
      targetHeight: 1080,
      outputPath: '/tmp/out.mp4',
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('concat=n=1:v=1:a=1');
  });

  it('输出路径永远是最后一个参数', () => {
    const args = buildConcatWithReencodeArgs({
      videoPaths: ['/tmp/a.mp4'],
      targetWidth: 1920,
      targetHeight: 1080,
      outputPath: '/tmp/final.mp4',
    });
    expect(args[args.length - 1]).toBe('/tmp/final.mp4');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video/ffmpeg.test.ts`
Expected: FAIL — `buildConcatWithReencodeArgs` 未导出

- [ ] **Step 3: 写实现**

在 `src/lib/video/ffmpeg.ts` 末尾追加:

```typescript
export interface ConcatWithReencodeOpts {
  videoPaths: string[];
  targetWidth: number;
  targetHeight: number;
  outputPath: string;
}

/**
 * 重编码式拼接 —— 用于把片头/正片/片尾这类**非同源**素材接在一起。
 * 与 `buildConcatArgs`(concat demuxer + `-c copy`)的关键差异:
 * - `-c copy` 只对同一渲染器产出、编码参数严格一致的分镜安全; 用户自己上传的
 *   片头片尾编码参数任意, 字节拼接会漂移甚至直接失败(十九期已实测, 见 buildConcatAudioArgs 注释)。
 * - concat filter 要求所有输入流尺寸/SAR 严格一致, 所以每一路都 scale+pad 到正片尺寸
 *   (等比缩放不变形, 多余空间补黑边)。
 * - 无音轨的片段参与 `concat=a=1` 会直接报错, 所以每一路都额外开一个 anullsrc 静音输入,
 *   与该片段真实音轨 amix —— 有音轨时静音不改变听感, 无音轨时它就是那一路的音轨。
 */
export function buildConcatWithReencodeArgs(opts: ConcatWithReencodeOpts): string[] {
  const { targetWidth: W, targetHeight: H } = opts;
  const inputArgs: string[] = ['-y'];
  const filterParts: string[] = [];
  const concatLabels: string[] = [];

  opts.videoPaths.forEach((p, i) => {
    inputArgs.push('-i', p);
    // 每个真实输入后紧跟一路无限长的静音源(靠 concat 的 v/a 段长度收敛, 不会拖长输出)
    inputArgs.push('-f', 'lavfi', '-t', '3600', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    const vIn = i * 2;
    const aNull = i * 2 + 1;
    filterParts.push(
      `[${vIn}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${i}]`,
    );
    // `[${vIn}:a?]` 的 `?` 表示该流可选 —— 输入没有音轨时不报错, 此时只有静音源参与。
    filterParts.push(
      `[${vIn}:a?][${aNull}:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[a${i}]`,
    );
    concatLabels.push(`[v${i}][a${i}]`);
  });

  filterParts.push(`${concatLabels.join('')}concat=n=${opts.videoPaths.length}:v=1:a=1[outv][outa]`);

  return [
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    opts.outputPath,
  ];
}

export interface AttachIntroOutroOpts {
  videoPath: string;
  introPath?: string | null;
  outroPath?: string | null;
  outputPath: string;
}

/**
 * 把片头/片尾接到正片前后。两者都没配时直接把正片复制到 outputPath(不白跑一次转码)。
 * 目标尺寸取**正片**的真实尺寸 —— 片头片尾迁就正片, 而不是反过来。
 */
export async function attachIntroOutro(opts: AttachIntroOutroOpts): Promise<void> {
  const paths = [opts.introPath, opts.videoPath, opts.outroPath].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  if (paths.length === 1) {
    await fs.copyFile(opts.videoPath, opts.outputPath);
    return;
  }
  const { width, height } = await probeVideoDimensions(opts.videoPath);
  await execFileAsync(
    FFMPEG_BIN,
    buildConcatWithReencodeArgs({
      videoPaths: paths,
      targetWidth: width,
      targetHeight: height,
      outputPath: opts.outputPath,
    }),
    { timeout: 900_000 },
  );
}
```

- [ ] **Step 4: 运行纯函数测试确认通过**

Run: `npx vitest run tests/lib/video/ffmpeg.test.ts`
Expected: PASS

- [ ] **Step 5: 写真实 ffmpeg 集成测试**

创建 `tests/lib/video-production/intro-outro.test.ts`:

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { attachIntroOutro, probeVideo, hasAudioStream } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

interface RgbColor { r: number; g: number; b: number }

async function sampleFrameColor(videoPath: string, timestampSec: number): Promise<RgbColor> {
  const { stdout } = await execFileAsync(
    FFMPEG_BIN,
    ['-y', '-ss', String(timestampSec), '-i', videoPath, '-frames:v', '1',
     '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { timeout: 30_000, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
  );
  const buf = stdout as unknown as Buffer;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

function isCloseToColor(a: RgbColor, e: RgbColor, tol = 60): boolean {
  return Math.abs(a.r - e.r) <= tol && Math.abs(a.g - e.g) <= tol && Math.abs(a.b - e.b) <= tol;
}

const RED: RgbColor = { r: 255, g: 0, b: 0 };
const BLUE: RgbColor = { r: 0, g: 0, b: 255 };
const YELLOW: RgbColor = { r: 255, g: 255, b: 0 };

describe('attachIntroOutro', () => {
  let workDir: string;
  let mainPath: string;
  let introPath: string;
  let outroPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intro-outro-'));
    mainPath = path.join(workDir, 'main.mp4');
    introPath = path.join(workDir, 'intro.mp4');
    outroPath = path.join(workDir, 'outro.mp4');

    // 正片: 4 秒蓝色 + 音轨, 320x180
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=4:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', mainPath,
    ], { timeout: 60_000 });

    // 片头: 2 秒红色, **无音轨**且**尺寸不同**(验证静音补齐 + 尺寸对齐两条防御)
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=red:s=640x360:d=2:r=15', '-c:v', 'libx264', '-an', introPath,
    ], { timeout: 60_000 });

    // 片尾: 2 秒黄色 + 音轨, 又一个不同尺寸
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=yellow:s=480x270:d=2:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=600:duration=2',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', outroPath,
    ], { timeout: 60_000 });
  }, 180_000);

  it('片头+片尾都配: 总时长≈2+4+2, 三段画面各自落位, 输出有音轨', async () => {
    const outputPath = path.join(workDir, 'out-both.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath, outroPath, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(7.0);
    expect(probed.durationSec).toBeLessThan(9.0);

    expect(isCloseToColor(await sampleFrameColor(outputPath, 1.0), RED)).toBe(true);   // 片头
    expect(isCloseToColor(await sampleFrameColor(outputPath, 4.0), BLUE)).toBe(true);  // 正片
    expect(isCloseToColor(await sampleFrameColor(outputPath, 7.0), YELLOW)).toBe(true); // 片尾

    expect(await hasAudioStream(outputPath)).toBe(true);
  }, 180_000);

  it('只配片头: 总时长≈2+4, 开头是片头', async () => {
    const outputPath = path.join(workDir, 'out-intro-only.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath, outroPath: null, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(5.0);
    expect(probed.durationSec).toBeLessThan(7.0);
    expect(isCloseToColor(await sampleFrameColor(outputPath, 1.0), RED)).toBe(true);
  }, 180_000);

  it('都没配: 原样复制正片, 时长不变', async () => {
    const outputPath = path.join(workDir, 'out-none.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath: null, outroPath: null, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);
  }, 120_000);
});
```

- [ ] **Step 6: 运行集成测试确认通过**

Run: `npx vitest run tests/lib/video-production/intro-outro.test.ts`
Expected: PASS(3 个用例)。若片头静音补齐或尺寸对齐有问题会在这里真实暴露。

- [ ] **Step 7: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/video/ffmpeg.ts tests/lib/video/ffmpeg.test.ts tests/lib/video-production/intro-outro.test.ts
git commit -m "feat(video): 二十期 — 片头片尾重编码拼接(尺寸对齐+静音轨补齐)"
```

---

### Task 5: 包装段编排

**Files:**
- Create: `src/lib/video-production/packaging.ts`
- Test: `tests/lib/video-production/packaging.test.ts`

**Interfaces:**
- Consumes: `buildAssCaptions`/`CaptionEvent`(T2)、`mixBgm`/`attachIntroOutro`(T3/T4)、`burnCaptions` 需扩展支持 `.ass`
- Produces:
  - `interface PackagingOptions { captionStyle: CaptionStyle|null; captionEvents: CaptionEvent[]; bgmPath: string|null; bgmVolume: number; introPath: string|null; outroPath: string|null }`
  - `function needsPackaging(opts: PackagingOptions): boolean`
  - `async function runPackaging(input: { masterPath: string; workDir: string; outputPath: string; options: PackagingOptions; onStep?: (step: string) => Promise<void> }): Promise<void>`

**先决改动**:`burnCaptions`(`src/lib/video/ffmpeg.ts:339`)当前把内容写成固定 `.srt` 临时文件。需扩展一个可选 `format: 'srt'|'ass'` 参数(默认 `'srt'`,保持旧调用零改动),`'ass'` 时临时文件扩展名写 `.ass`——libass 靠扩展名判定解析器。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/video-production/packaging.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const ffmpegMock = vi.hoisted(() => ({
  burnCaptions: vi.fn(async () => undefined),
  mixBgm: vi.fn(async () => undefined),
  attachIntroOutro: vi.fn(async () => undefined),
}));
vi.mock('@/lib/video/ffmpeg', () => ffmpegMock);

const fsMock = vi.hoisted(() => ({ copyFile: vi.fn(async () => undefined) }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { needsPackaging, runPackaging } from '@/lib/video-production/packaging';
import { defaultCaptionStyle } from '@/lib/video-template/model';

beforeEach(() => vi.clearAllMocks());

const EMPTY = {
  captionStyle: null,
  captionEvents: [],
  bgmPath: null,
  bgmVolume: 0.15,
  introPath: null,
  outroPath: null,
};

describe('needsPackaging', () => {
  it('三项都没配 → false', () => {
    expect(needsPackaging(EMPTY)).toBe(false);
  });

  it('配了字幕样式但没有字幕事件 → false(无内容可烧)', () => {
    expect(needsPackaging({ ...EMPTY, captionStyle: defaultCaptionStyle() })).toBe(false);
  });

  it('配了字幕样式且有事件 → true', () => {
    expect(needsPackaging({
      ...EMPTY,
      captionStyle: defaultCaptionStyle(),
      captionEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
    })).toBe(true);
  });

  it('只配 BGM → true', () => {
    expect(needsPackaging({ ...EMPTY, bgmPath: '/tmp/bgm.mp3' })).toBe(true);
  });

  it('只配片头 → true', () => {
    expect(needsPackaging({ ...EMPTY, introPath: '/tmp/intro.mp4' })).toBe(true);
  });
});

describe('runPackaging', () => {
  const base = {
    masterPath: '/root/master.mp4',
    workDir: '/root',
    outputPath: '/root/packaged.mp4',
  };

  it('三步全配时按 字幕 → BGM → 片头片尾 顺序执行', async () => {
    const order: string[] = [];
    ffmpegMock.burnCaptions.mockImplementation(async () => { order.push('captions'); });
    ffmpegMock.mixBgm.mockImplementation(async () => { order.push('bgm'); });
    ffmpegMock.attachIntroOutro.mockImplementation(async () => { order.push('intro-outro'); });

    await runPackaging({
      ...base,
      options: {
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: '字幕' }],
        bgmPath: '/tmp/bgm.mp3',
        bgmVolume: 0.2,
        introPath: '/tmp/intro.mp4',
        outroPath: '/tmp/outro.mp4',
      },
    });

    expect(order).toEqual(['captions', 'bgm', 'intro-outro']);
  });

  it('字幕用 .ass 格式烧录, 内容是生成的 ASS 而不是 SRT', async () => {
    await runPackaging({
      ...base,
      options: {
        ...EMPTY,
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: '测试' }],
      },
    });

    expect(ffmpegMock.burnCaptions).toHaveBeenCalledTimes(1);
    const call = ffmpegMock.burnCaptions.mock.calls[0][0];
    expect(call.format).toBe('ass');
    expect(call.srt).toContain('[V4+ Styles]');
    expect(call.srt).toContain('测试');
  });

  it('只配 BGM 时不调用字幕与片头片尾', async () => {
    await runPackaging({ ...base, options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3' } });

    expect(ffmpegMock.burnCaptions).not.toHaveBeenCalled();
    expect(ffmpegMock.attachIntroOutro).not.toHaveBeenCalled();
    expect(ffmpegMock.mixBgm).toHaveBeenCalledTimes(1);
    expect(ffmpegMock.mixBgm.mock.calls[0][0].bgmPath).toBe('/tmp/bgm.mp3');
  });

  it('每步的输入是上一步的输出, 最后一步写到 outputPath', async () => {
    await runPackaging({
      ...base,
      options: {
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
        bgmPath: '/tmp/bgm.mp3',
        bgmVolume: 0.2,
        introPath: '/tmp/intro.mp4',
        outroPath: null,
      },
    });

    const captionOut = ffmpegMock.burnCaptions.mock.calls[0][0].outputPath;
    const bgmIn = ffmpegMock.mixBgm.mock.calls[0][0].videoPath;
    const bgmOut = ffmpegMock.mixBgm.mock.calls[0][0].outputPath;
    const finalIn = ffmpegMock.attachIntroOutro.mock.calls[0][0].videoPath;
    const finalOut = ffmpegMock.attachIntroOutro.mock.calls[0][0].outputPath;

    expect(ffmpegMock.burnCaptions.mock.calls[0][0].videoPath).toBe('/root/master.mp4');
    expect(bgmIn).toBe(captionOut);
    expect(finalIn).toBe(bgmOut);
    expect(finalOut).toBe('/root/packaged.mp4');
  });

  it('无需包装时原样复制 master 到 outputPath, 不调任何 ffmpeg', async () => {
    await runPackaging({ ...base, options: EMPTY });

    expect(ffmpegMock.burnCaptions).not.toHaveBeenCalled();
    expect(ffmpegMock.mixBgm).not.toHaveBeenCalled();
    expect(ffmpegMock.attachIntroOutro).not.toHaveBeenCalled();
    expect(fsMock.copyFile).toHaveBeenCalledWith('/root/master.mp4', '/root/packaged.mp4');
  });

  it('onStep 回调按步骤名依次触发(供 worker 落状态)', async () => {
    const steps: string[] = [];
    await runPackaging({
      ...base,
      options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3', introPath: '/tmp/intro.mp4' },
      onStep: async (s) => { steps.push(s); },
    });
    expect(steps).toEqual(['bgm', 'intro-outro']);
  });

  it('某一步失败时错误带上步骤名(便于定位)', async () => {
    ffmpegMock.mixBgm.mockRejectedValueOnce(new Error('ffmpeg 崩了'));
    await expect(
      runPackaging({ ...base, options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3' } }),
    ).rejects.toThrow(/BGM/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video-production/packaging.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/video-production/packaging"`

- [ ] **Step 3: 先扩展 burnCaptions 支持 .ass**

修改 `src/lib/video/ffmpeg.ts` 的 `BurnCaptionsOpts` 与 `burnCaptions`:

```typescript
export interface BurnCaptionsOpts {
  videoPath: string;
  srt: string; // 字幕内容(不是文件路径)，内部负责写临时文件
  outputPath: string;
  /**
   * 字幕格式。默认 'srt' —— 旧调用方(十九期真人出镜默认字幕)零改动。
   * 'ass' 时临时文件写 .ass 扩展名: libass 靠扩展名选解析器, 写成 .srt 会把
   * 整个 ASS 头部当成字幕正文渲染出来。
   */
  format?: 'srt' | 'ass';
}

export async function burnCaptions(opts: BurnCaptionsOpts): Promise<void> {
  const ext = opts.format === 'ass' ? 'ass' : 'srt';
  const srtPath = path.join(os.tmpdir(), `captions-${randomUUID()}.${ext}`);
  await fs.writeFile(srtPath, opts.srt, 'utf-8');
  try {
    await execFileAsync(
      FFMPEG_BIN,
      buildBurnCaptionsArgs({ videoPath: opts.videoPath, srtPath, outputPath: opts.outputPath }),
      { timeout: 600_000 },
    );
  } finally {
    await fs.unlink(srtPath).catch(() => {});
  }
}
```

注意 `tests/lib/video-production/burn-captions.test.ts` 里检查临时文件残留的正则 `/^captions-.*\.srt$/` 需要放宽为 `/^captions-.*\.(srt|ass)$/`,并补一个 `.ass` 烧录的真实用例:

```typescript
  it(
    '真实烧录 .ass 样式字幕: 输出成功且时长不变',
    async () => {
      const outputPath = path.join(workDir, 'output-ass.mp4');
      const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PingFang SC,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,90,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,中文样式字幕
`;
      await burnCaptions({ videoPath: sourceVideoPath, srt: ass, outputPath, format: 'ass' });

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(1.5);
      expect(probeResult.durationSec).toBeLessThan(2.5);
    },
    60_000,
  );
```

- [ ] **Step 4: 写包装编排实现**

创建 `src/lib/video-production/packaging.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import { burnCaptions, mixBgm, attachIntroOutro } from '@/lib/video/ffmpeg';
import { buildAssCaptions, type CaptionEvent } from '@/lib/video-production/ass-captions';
import type { CaptionStyle } from '@/lib/video-template/model';

export interface PackagingOptions {
  captionStyle: CaptionStyle | null;
  captionEvents: CaptionEvent[];
  bgmPath: string | null;
  bgmVolume: number;
  introPath: string | null;
  outroPath: string | null;
}

export function needsPackaging(opts: PackagingOptions): boolean {
  const hasCaptions = Boolean(opts.captionStyle) && opts.captionEvents.length > 0;
  return hasCaptions || Boolean(opts.bgmPath) || Boolean(opts.introPath) || Boolean(opts.outroPath);
}

/**
 * 成片包装段(二十期) —— 三交付模式共用, 只在 master 渲染完成后执行(预览不包装, spec §3.1)。
 * 顺序固定 字幕 → BGM → 片头片尾: 片头片尾自带声画, 放最后才不会被字幕和 BGM 渗到。
 * 每步的输入是上一步的输出, 中间产物落在 workDir 内, 便于失败时定位到底哪一步崩的。
 */
export async function runPackaging(input: {
  masterPath: string;
  workDir: string;
  outputPath: string;
  options: PackagingOptions;
  onStep?: (step: string) => Promise<void>;
}): Promise<void> {
  const { masterPath, workDir, outputPath, options, onStep } = input;

  if (!needsPackaging(options)) {
    await fs.copyFile(masterPath, outputPath);
    return;
  }

  const steps: Array<{ name: string; label: string; run: (inPath: string, outPath: string) => Promise<void> }> = [];

  if (options.captionStyle && options.captionEvents.length > 0) {
    const style = options.captionStyle;
    const events = options.captionEvents;
    steps.push({
      name: 'captions',
      label: '字幕烧录',
      run: (inPath, outPath) =>
        burnCaptions({
          videoPath: inPath,
          srt: buildAssCaptions(events, style),
          outputPath: outPath,
          format: 'ass',
        }),
    });
  }

  if (options.bgmPath) {
    const bgmPath = options.bgmPath;
    steps.push({
      name: 'bgm',
      label: 'BGM 混音',
      run: (inPath, outPath) =>
        mixBgm({ videoPath: inPath, bgmPath, bgmVolume: options.bgmVolume, outputPath: outPath }),
    });
  }

  if (options.introPath || options.outroPath) {
    steps.push({
      name: 'intro-outro',
      label: '片头片尾拼接',
      run: (inPath, outPath) =>
        attachIntroOutro({
          videoPath: inPath,
          introPath: options.introPath,
          outroPath: options.outroPath,
          outputPath: outPath,
        }),
    });
  }

  let current = masterPath;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const isLast = i === steps.length - 1;
    const stepOutput = isLast ? outputPath : path.join(workDir, `packaging-${step.name}.mp4`);
    if (onStep) await onStep(step.name);
    try {
      await step.run(current, stepOutput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`成片包装失败于「${step.label}」步骤: ${msg}`);
    }
    current = stepOutput;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/lib/video-production/packaging.test.ts tests/lib/video-production/burn-captions.test.ts`
Expected: PASS(包装 12 个用例 + burn-captions 3 个用例)

- [ ] **Step 6: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/video-production/packaging.ts src/lib/video/ffmpeg.ts tests/lib/video-production/packaging.test.ts tests/lib/video-production/burn-captions.test.ts
git commit -m "feat(video-production): 二十期 — 包装段编排(字幕→BGM→片头片尾) + burnCaptions 支持 .ass"
```

---

### Task 6: worker 接线包装段

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`
- Create: `src/lib/video-production/packaging-input.ts`
- Test: `tests/lib/video-production/packaging-input.test.ts`

**Interfaces:**
- Consumes: `PackagingOptions`(T5)、`captionEventsFromTranscript`/`captionEventsFromAlignedActs`(T2)
- Produces:
  - `function buildPackagingOptions(input: { template: VideoTemplateRecord|null; mode: DeliveryMode; transcript: TranscriptSegment[]|null; alignedActs: AlignedAct[]|null; narrations: Record<string,string>; shotEvents: CaptionEvent[] }): PackagingOptions`
  - `type VideoTemplateRecord = { captionStyle: unknown; bgmPath: string|null; bgmVolume: number; introPath: string|null; outroPath: string|null }`

**设计要点**:worker 里只做"取数据 → 调 `buildPackagingOptions` → 调 `runPackaging`",字幕事件源的选择逻辑抽成纯函数单测。真人出镜优先用 ASR 原话;其余用对齐幕边界;都没有时用分镜时长铺排(`shotEvents`,由 worker 从 `direction.shots` 现算)。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/video-production/packaging-input.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildPackagingOptions } from '@/lib/video-production/packaging-input';
import { defaultCaptionStyle } from '@/lib/video-template/model';

const TEMPLATE = {
  captionStyle: defaultCaptionStyle(),
  bgmPath: '/tmp/bgm.mp3',
  bgmVolume: 0.2,
  introPath: '/tmp/intro.mp4',
  outroPath: null,
};

const BASE = {
  transcript: null,
  alignedActs: null,
  narrations: {},
  shotEvents: [],
};

describe('buildPackagingOptions', () => {
  it('无模板时返回全空配置(包装段整段跳过, 零迁移)', () => {
    const opts = buildPackagingOptions({ ...BASE, template: null, mode: 'ppt-narration' });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
    expect(opts.bgmPath).toBeNull();
    expect(opts.introPath).toBeNull();
    expect(opts.outroPath).toBeNull();
  });

  it('模板的 BGM/片头片尾原样透传', () => {
    const opts = buildPackagingOptions({ ...BASE, template: TEMPLATE, mode: 'ppt-narration' });
    expect(opts.bgmPath).toBe('/tmp/bgm.mp3');
    expect(opts.bgmVolume).toBe(0.2);
    expect(opts.introPath).toBe('/tmp/intro.mp4');
    expect(opts.outroPath).toBeNull();
  });

  it('真人出镜: 字幕事件来自 ASR 原话转写', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'talking-head-broll',
      transcript: [{ start: 0, end: 1, text: '真实原话' }] as any,
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 2000 }] as any,
      narrations: { hook: '稿子上的台词' },
    });
    expect(opts.captionEvents).toHaveLength(1);
    expect(opts.captionEvents[0].text).toBe('真实原话');
  });

  it('插画 TTS: 字幕事件来自对齐幕边界 + 稿子台词', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'illustration-tts',
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 2000 }] as any,
      narrations: { hook: '稿子上的台词' },
    });
    expect(opts.captionEvents).toEqual([{ startMs: 0, endMs: 2000, text: '稿子上的台词' }]);
  });

  it('图文口播(无对齐无转写): 字幕事件来自分镜时长铺排', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'ppt-narration',
      shotEvents: [{ startMs: 0, endMs: 3000, text: '分镜文案' }],
    });
    expect(opts.captionEvents).toEqual([{ startMs: 0, endMs: 3000, text: '分镜文案' }]);
  });

  it('模板 captionStyle 为 null 时不产出字幕事件(明确关掉字幕)', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: { ...TEMPLATE, captionStyle: null },
      mode: 'talking-head-broll',
      transcript: [{ start: 0, end: 1, text: '原话' }] as any,
    });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
  });

  it('captionStyle 是非法 JSON 形状时降级为不烧字幕而不是崩溃', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: { ...TEMPLATE, captionStyle: { fontFamily: 'Comic Sans MS' } },
      mode: 'ppt-narration',
      shotEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
    });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/video-production/packaging-input.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

创建 `src/lib/video-production/packaging-input.ts`:

```typescript
import type { DeliveryMode } from '@/lib/cockpit/model';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { CaptionStyleSchema, type CaptionStyle } from '@/lib/video-template/model';
import {
  captionEventsFromTranscript,
  captionEventsFromAlignedActs,
  type CaptionEvent,
} from '@/lib/video-production/ass-captions';
import type { PackagingOptions } from '@/lib/video-production/packaging';

export type VideoTemplateRecord = {
  captionStyle: unknown;
  bgmPath: string | null;
  bgmVolume: number;
  introPath: string | null;
  outroPath: string | null;
};

/** DB 里的 captionStyle 是 Json 列, 形状不可信 —— 校验失败就降级为不烧字幕, 不让整条任务崩。 */
function parseCaptionStyle(raw: unknown): CaptionStyle | null {
  if (!raw) return null;
  const parsed = CaptionStyleSchema.safeParse(raw);
  return parsed.success ? (parsed.data as CaptionStyle) : null;
}

/**
 * 把模板配置 + 本次任务的真实时间轴数据合成包装段入参。
 * 字幕事件源按交付模式取: 真人出镜优先 ASR 原话(用户实际念的可能与稿子有出入),
 * 其次是对齐后的幕边界 + 稿子台词(插画 TTS), 都没有则用分镜时长铺排(图文口播)。
 */
export function buildPackagingOptions(input: {
  template: VideoTemplateRecord | null;
  mode: DeliveryMode;
  transcript: TranscriptSegment[] | null;
  alignedActs: AlignedAct[] | null;
  narrations: Record<string, string>;
  shotEvents: CaptionEvent[];
}): PackagingOptions {
  if (!input.template) {
    return {
      captionStyle: null,
      captionEvents: [],
      bgmPath: null,
      bgmVolume: 0.15,
      introPath: null,
      outroPath: null,
    };
  }

  const captionStyle = parseCaptionStyle(input.template.captionStyle);

  let captionEvents: CaptionEvent[] = [];
  if (captionStyle) {
    if (input.mode === 'talking-head-broll' && input.transcript?.length) {
      captionEvents = captionEventsFromTranscript(input.transcript);
    } else if (input.alignedActs?.length) {
      captionEvents = captionEventsFromAlignedActs(input.alignedActs, input.narrations);
    } else {
      captionEvents = input.shotEvents;
    }
  }

  return {
    captionStyle,
    captionEvents,
    bgmPath: input.template.bgmPath,
    bgmVolume: input.template.bgmVolume,
    introPath: input.template.introPath,
    outroPath: input.template.outroPath,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/lib/video-production/packaging-input.test.ts`
Expected: PASS(7 个用例)

- [ ] **Step 5: worker 接线**

修改 `src/jobs/workers/video-production-worker.ts`:

① 顶部加导入:

```typescript
import { runPackaging } from '@/lib/video-production/packaging';
import { buildPackagingOptions } from '@/lib/video-production/packaging-input';
import type { CaptionEvent } from '@/lib/video-production/ass-captions';
```

② 在 `handleProduce` 里,三分支 dispatch 之后、catch 之前插入包装段(注意:仅 master 模式,且 `templateId` 非空):

```typescript
    // 二十期: 成片包装段 —— 三交付模式共用, 只在 master 渲染完成后执行(预览审内容, 不包装)。
    // templateId 为空(内容详情页旧入口)时整段跳过, 行为与十九期字符级一致。
    if (mode === 'master' && vp.templateId) {
      const template = await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } });
      const refreshed = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
      const masterPath = refreshed?.masterPath;
      if (template && masterPath) {
        await setStatus('packaging');
        const narrations = await loadNarrations(vp.contentId);
        const packagedPath = path.join(vp.productionRoot, 'packaged.mp4');
        await runPackaging({
          masterPath,
          workDir: vp.productionRoot,
          outputPath: packagedPath,
          options: buildPackagingOptions({
            template,
            mode: vp.mode as DeliveryMode,
            transcript: (refreshed?.rawTranscript as unknown as TranscriptSegment[] | null) ?? null,
            alignedActs: (refreshed?.alignedActs as unknown as AlignedAct[] | null) ?? null,
            narrations,
            shotEvents: await loadShotCaptionEvents(vp.productionRoot),
          }),
        });
        // 包装后的成片取代原 masterPath 作为交付物; 未包装的 master.mp4 保留在
        // productionRoot 里(包装若失败也有东西可下, spec §3.1)。
        await setStatus('done', { masterPath: packagedPath });
      }
    }
```

③ 在文件里 `shotDir` 函数之后加两个辅助函数:

```typescript
/** 取该内容六幕稿的逐幕台词(act → narration), 供字幕按幕边界铺排; 取不到时返回空表。 */
async function loadNarrations(contentId: string): Promise<Record<string, string>> {
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  const draft = content?.scriptDraftId
    ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
    : null;
  const parsed = draft ? parseDraftOutput(draft.output) : null;
  if (!parsed?.acts) return {};
  return Object.fromEntries(parsed.acts.map((a) => [a.act, a.narration]));
}

/**
 * 图文口播模式没有 ASR 也没有 TTS 时长, 字幕时间轴只能来自 Director 排布的分镜边界 ——
 * 直接读回持久化的 direction.json(master 渲染本来就复用它), 用每镜的 caption/旁白文本。
 * 读不到时返回空数组(降级为不烧字幕, 不让整条任务崩)。
 */
async function loadShotCaptionEvents(productionRoot: string): Promise<CaptionEvent[]> {
  try {
    const raw = await fs.readFile(path.join(productionRoot, 'direction.json'), 'utf-8');
    const direction = JSON.parse(raw) as DirectorResponse;
    return direction.shots
      .map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: (s.caption ?? '').trim() }))
      .filter((e) => e.text.length > 0);
  } catch {
    return [];
  }
}
```

**注意**:`s.caption` 字段名必须核对 `src/lib/video-production/director-prompt.ts` 里 `DirectorResponse` 的 shot 形状——实现时先 `grep -n "shotId\|caption\|narration\|text" src/lib/video-production/director-prompt.ts` 确认真实字段名,用真实存在的那个文本字段;如果 shot 没有任何文本字段,则 `loadShotCaptionEvents` 直接返回 `[]` 并在注释里写明"图文口播模式暂无字幕文本源"。

④ 顶部导入补 `DeliveryMode`:

```typescript
import type { DeliveryMode } from '@/lib/cockpit/model';
```

- [ ] **Step 6: 验证 worker 改动**

Run: `npx tsc --noEmit`
Expected: 全绿。若 `s.caption` 字段不存在会在这里报错——按 Step 5 的注意事项改。

- [ ] **Step 7: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/jobs/workers/video-production-worker.ts src/lib/video-production/packaging-input.ts tests/lib/video-production/packaging-input.test.ts
git commit -m "feat(video-production): 二十期 — worker 接线成片包装段(templateId 为空时整段跳过)"
```

---

### Task 7: 模板 CRUD API + 素材上传

**Files:**
- Create: `src/lib/video-template/store.ts`
- Create: `src/app/api/v1/video-templates/route.ts`
- Create: `src/app/api/v1/video-templates/[id]/route.ts`
- Create: `src/app/api/v1/video-templates/[id]/duplicate/route.ts`
- Create: `src/app/api/v1/video-templates/[id]/assets/route.ts`
- Test: `tests/api/video-templates/crud.test.ts`、`tests/api/video-templates/assets.test.ts`

**Interfaces:**
- Consumes: `VideoTemplateConfigSchema`/`PRESET_TEMPLATES`(T1)
- Produces:
  - `function templateAssetDir(templateId: string): string`
  - `async function seedPresetsIfEmpty(userId: string): Promise<void>`
  - REST 语义见下

- [ ] **Step 1: 写失败的 CRUD 测试**

创建 `tests/api/video-templates/crud.test.ts`(mock 范式照抄 `tests/api/cockpit/video-productions.test.ts`):

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: {
    count: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { GET, POST } from '@/app/api/v1/video-templates/route';
import { PUT, DELETE } from '@/app/api/v1/video-templates/[id]/route';
import { POST as DUPLICATE } from '@/app/api/v1/video-templates/[id]/duplicate/route';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

beforeEach(() => vi.clearAllMocks());

function jsonReq(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/v1/video-templates', () => {
  it('用户 0 条模板时播种 3 个预设', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(0);
    prismaMock.videoTemplate.findMany.mockResolvedValue([]);

    await GET();

    expect(prismaMock.videoTemplate.createMany).toHaveBeenCalledTimes(1);
    const seeded = prismaMock.videoTemplate.createMany.mock.calls[0][0].data;
    expect(seeded).toHaveLength(3);
    expect(seeded.every((t: any) => t.isPreset === true)).toBe(true);
    expect(seeded.every((t: any) => t.userId === 'user1')).toBe(true);
  });

  it('已有模板时不重复播种(幂等)', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(2);
    prismaMock.videoTemplate.findMany.mockResolvedValue([]);

    await GET();

    expect(prismaMock.videoTemplate.createMany).not.toHaveBeenCalled();
  });

  it('只返回当前用户的模板', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(1);
    prismaMock.videoTemplate.findMany.mockResolvedValue([{ id: 't1' }]);

    await GET();

    expect(prismaMock.videoTemplate.findMany.mock.calls[0][0].where).toEqual({ userId: 'user1' });
  });
});

describe('POST /api/v1/video-templates', () => {
  it('合法配置 → 创建成功', async () => {
    prismaMock.videoTemplate.create.mockResolvedValue({ id: 'new1' });
    const res = await POST(jsonReq({ ...PRESET_TEMPLATES[0], name: '我的模板' }));
    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.videoTemplate.create.mock.calls[0][0].data.isPreset).toBe(false);
  });

  it('非法交付模式 → 400, 不落库', async () => {
    const res = await POST(jsonReq({ ...PRESET_TEMPLATES[0], deliveryMode: 'manual' }));
    expect(res.status).toBe(400);
    expect(prismaMock.videoTemplate.create).not.toHaveBeenCalled();
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/v1/video-templates/[id]', () => {
  it('归属别的用户 → 404, 不更新', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await PUT(jsonReq(PRESET_TEMPLATES[0]) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
  });

  it('预设模板同样可以改(isPreset 只是徽标)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1', isPreset: true });
    prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });
    const res = await PUT(jsonReq({ ...PRESET_TEMPLATES[0], name: '改过的' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.name).toBe('改过的');
  });
});

describe('DELETE /api/v1/video-templates/[id]', () => {
  it('删除模板同时清理素材目录', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    prismaMock.videoTemplate.delete.mockResolvedValue({ id: 't1' });

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.delete).toHaveBeenCalledTimes(1);
    expect(fsMock.rm).toHaveBeenCalledTimes(1);
    expect(fsMock.rm.mock.calls[0][0]).toContain('t1');
  });

  it('归属别的用户 → 404, 不删除也不动文件', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoTemplate.delete).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/video-templates/[id]/duplicate', () => {
  it('复制素材文件本体到新模板目录, 而不是共用路径', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'user1',
      name: '原模板',
      description: '',
      deliveryMode: 'ppt-narration',
      visualStyle: 'card',
      palette: null,
      voicePreset: null,
      scriptPrompt: null,
      captionStyle: null,
      bgmPath: '/templates/t1/bgm.mp3',
      bgmVolume: 0.15,
      introPath: null,
      outroPath: null,
      isPreset: true,
    });
    prismaMock.videoTemplate.create.mockResolvedValue({ id: 'copy1' });

    const res = await DUPLICATE(new Request('http://x', { method: 'POST' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    const created = prismaMock.videoTemplate.create.mock.calls[0][0].data;
    // 新模板的 bgmPath 必须指向自己的目录, 不能还指着 t1
    expect(created.bgmPath).not.toBe('/templates/t1/bgm.mp3');
    expect(created.bgmPath).toContain(created.id);
    // 副本不是预设
    expect(created.isPreset).toBe(false);
    expect(created.name).toContain('原模板');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/api/video-templates/crud.test.ts`
Expected: FAIL — 路由模块不存在

- [ ] **Step 3: 写 store 与四个路由**

创建 `src/lib/video-template/store.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

/** 模板素材根目录 —— 与 VIDEO_PRODUCTION_ROOT 同一范式(见 video-productions/route.ts)。 */
export function templateAssetDir(templateId: string): string {
  return path.join(process.env.VIDEO_TEMPLATE_ROOT || './video-templates', templateId);
}

export function newTemplateId(): string {
  return randomUUID().slice(0, 12);
}

/**
 * 首次进入模板页时播种 3 个内置预设(用户 0 条模板时才播)。幂等: count>0 直接返回,
 * 跑两次不会重复播种 —— 与四期迁移脚本"必须先有守卫再跑"是同一教训。
 */
export async function seedPresetsIfEmpty(userId: string): Promise<void> {
  const count = await prisma.videoTemplate.count({ where: { userId } });
  if (count > 0) return;
  const now = new Date().toISOString();
  await prisma.videoTemplate.createMany({
    data: PRESET_TEMPLATES.map((preset) => ({
      id: newTemplateId(),
      userId,
      isPreset: true,
      createdAt: now,
      updatedAt: now,
      name: preset.name,
      description: preset.description,
      deliveryMode: preset.deliveryMode,
      visualStyle: preset.visualStyle,
      palette: preset.palette ?? undefined,
      voicePreset: preset.voicePreset ?? undefined,
      scriptPrompt: preset.scriptPrompt ?? undefined,
      captionStyle: preset.captionStyle ?? undefined,
      bgmPath: preset.bgmPath,
      bgmVolume: preset.bgmVolume,
      introPath: preset.introPath,
      outroPath: preset.outroPath,
    })),
  });
}
```

创建 `src/app/api/v1/video-templates/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { VideoTemplateConfigSchema } from '@/lib/video-template/model';
import { seedPresetsIfEmpty, newTemplateId } from '@/lib/video-template/store';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  await seedPresetsIfEmpty(user.id);
  const templates = await prisma.videoTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ templates });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = VideoTemplateConfigSchema.safeParse(body);
  if (!parsed.success) return fail('模板配置不合法', 400);
  const cfg = parsed.data;

  const user = await getOrCreateDefaultUser();
  const now = new Date().toISOString();
  const created = await prisma.videoTemplate.create({
    data: {
      id: newTemplateId(),
      userId: user.id,
      isPreset: false,
      createdAt: now,
      updatedAt: now,
      name: cfg.name,
      description: cfg.description,
      deliveryMode: cfg.deliveryMode,
      visualStyle: cfg.visualStyle,
      palette: cfg.palette ?? undefined,
      voicePreset: cfg.voicePreset ?? undefined,
      scriptPrompt: cfg.scriptPrompt ?? undefined,
      captionStyle: cfg.captionStyle ?? undefined,
      bgmPath: cfg.bgmPath,
      bgmVolume: cfg.bgmVolume,
      introPath: cfg.introPath,
      outroPath: cfg.outroPath,
    },
  });
  return ok({ template: created });
}
```

创建 `src/app/api/v1/video-templates/[id]/route.ts`:

```typescript
import fs from 'fs/promises';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { VideoTemplateConfigSchema } from '@/lib/video-template/model';
import { templateAssetDir } from '@/lib/video-template/store';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);
  return ok({ template: t });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = VideoTemplateConfigSchema.safeParse(body);
  if (!parsed.success) return fail('模板配置不合法', 400);
  const cfg = parsed.data;

  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  // isPreset 只是 UI 徽标, 预设模板同样可改(用户明确要求"对某一个模板不断调整")。
  const updated = await prisma.videoTemplate.update({
    where: { id: params.id },
    data: {
      name: cfg.name,
      description: cfg.description,
      deliveryMode: cfg.deliveryMode,
      visualStyle: cfg.visualStyle,
      palette: cfg.palette ?? undefined,
      voicePreset: cfg.voicePreset ?? undefined,
      scriptPrompt: cfg.scriptPrompt ?? undefined,
      captionStyle: cfg.captionStyle ?? undefined,
      bgmPath: cfg.bgmPath,
      bgmVolume: cfg.bgmVolume,
      introPath: cfg.introPath,
      outroPath: cfg.outroPath,
      updatedAt: new Date().toISOString(),
    },
  });
  return ok({ template: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  await prisma.videoTemplate.delete({ where: { id: params.id } });
  // 素材目录随模板一起清理; 失败不阻断删除(模板记录已经没了, 留下孤儿文件不影响正确性)。
  await fs.rm(templateAssetDir(params.id), { recursive: true, force: true }).catch(() => {});
  return ok({ deleted: true });
}
```

创建 `src/app/api/v1/video-templates/[id]/duplicate/route.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { templateAssetDir, newTemplateId } from '@/lib/video-template/store';

/**
 * 复制模板。素材**复制文件本体**到新模板目录 —— 只复制引用会在删除原模板(连带清理
 * 素材目录)时让副本悬空(spec §4)。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const src = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!src || src.userId !== user.id) return fail('模板不存在', 404);

  const newId = newTemplateId();
  const newDir = templateAssetDir(newId);
  await fs.mkdir(newDir, { recursive: true });

  async function copyAsset(p: string | null): Promise<string | null> {
    if (!p) return null;
    const dest = path.join(newDir, path.basename(p));
    try {
      await fs.copyFile(p, dest);
      return dest;
    } catch {
      // 原文件已丢失: 副本就不带这项素材, 而不是让整个复制失败。
      return null;
    }
  }

  const now = new Date().toISOString();
  const created = await prisma.videoTemplate.create({
    data: {
      id: newId,
      userId: user.id,
      isPreset: false, // 副本不再是预设
      createdAt: now,
      updatedAt: now,
      name: `${src.name} 副本`,
      description: src.description,
      deliveryMode: src.deliveryMode,
      visualStyle: src.visualStyle,
      palette: src.palette ?? undefined,
      voicePreset: src.voicePreset ?? undefined,
      scriptPrompt: src.scriptPrompt ?? undefined,
      captionStyle: src.captionStyle ?? undefined,
      bgmPath: await copyAsset(src.bgmPath),
      bgmVolume: src.bgmVolume,
      introPath: await copyAsset(src.introPath),
      outroPath: await copyAsset(src.outroPath),
    },
  });
  return ok({ template: created });
}
```

- [ ] **Step 4: 运行 CRUD 测试确认通过**

Run: `npx vitest run tests/api/video-templates/crud.test.ts`
Expected: PASS(11 个用例)

- [ ] **Step 5: 写素材上传测试**

创建 `tests/api/video-templates/assets.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { POST } from '@/app/api/v1/video-templates/[id]/assets/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
  prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });
});

function uploadReq(kind: string, file: Blob, fileName: string): Request {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file, fileName);
  return new Request('http://x', { method: 'POST', body: fd });
}

const mp3 = () => new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' });
const mp4 = () => new Blob([new Uint8Array(1000)], { type: 'video/mp4' });

describe('POST /api/v1/video-templates/[id]/assets', () => {
  it('上传 BGM → 落盘并回写 bgmPath', async () => {
    const res = await POST(uploadReq('bgm', mp3(), 'song.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.bgmPath).toContain('t1');
  });

  it('上传片头 → 回写 introPath', async () => {
    await POST(uploadReq('intro', mp4(), 'intro.mp4') as any, { params: { id: 't1' } });
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.introPath).toContain('t1');
  });

  it('上传片尾 → 回写 outroPath', async () => {
    await POST(uploadReq('outro', mp4(), 'outro.mp4') as any, { params: { id: 't1' } });
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.outroPath).toContain('t1');
  });

  it('非法 kind → 400, 不落盘', async () => {
    const res = await POST(uploadReq('whatever', mp4(), 'x.mp4') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('BGM 位置传了视频文件 → 400(MIME 白名单按 kind 区分)', async () => {
    const res = await POST(uploadReq('bgm', mp4(), 'x.mp4') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('超过大小上限 → 400', async () => {
    const huge = new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' });
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 });
    const res = await POST(uploadReq('bgm', huge, 'big.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('归属别的用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await POST(uploadReq('bgm', mp3(), 'x.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('恶意文件名不会拼出越权路径(扩展名白名单)', async () => {
    await POST(uploadReq('bgm', mp3(), '../../etc/passwd.mp3') as any, { params: { id: 't1' } });
    const writtenPath = fsMock.writeFile.mock.calls[0][0] as string;
    expect(writtenPath).not.toContain('..');
    expect(writtenPath).toContain('t1');
  });
});
```

- [ ] **Step 6: 写素材上传路由**

创建 `src/app/api/v1/video-templates/[id]/assets/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { templateAssetDir } from '@/lib/video-template/store';

const KIND_SPEC = {
  bgm: {
    field: 'bgmPath' as const,
    mime: /^audio\/(mpeg|mp3|wav|x-wav|x-m4a|mp4|aac)$/,
    maxBytes: 50 * 1024 * 1024,
    fallbackExt: 'mp3',
  },
  intro: {
    field: 'introPath' as const,
    mime: /^video\/(mp4|quicktime|webm|x-matroska)$/,
    maxBytes: 200 * 1024 * 1024,
    fallbackExt: 'mp4',
  },
  outro: {
    field: 'outroPath' as const,
    mime: /^video\/(mp4|quicktime|webm|x-matroska)$/,
    maxBytes: 200 * 1024 * 1024,
    fallbackExt: 'mp4',
  },
};

/** 只接受简单字母数字扩展名, 防构造文件名拼出越权路径(同 upload-source 路由的 safeExt)。 */
function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

/** 模板素材上传(二十期): BGM / 片头 / 片尾, 素材全部由用户自己上传(spec §2.3)。 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('multipart 解析失败', 400); }

  const kind = form.get('kind');
  if (typeof kind !== 'string' || !(kind in KIND_SPEC)) return fail('kind 必须是 bgm/intro/outro', 400);
  const spec = KIND_SPEC[kind as keyof typeof KIND_SPEC];

  const file = form.get('file');
  if (!(file instanceof File)) return fail('缺少 file 字段', 400);
  if (!spec.mime.test(file.type)) return fail(`不支持的文件格式: ${file.type}`, 400);
  if (file.size > spec.maxBytes) {
    return fail(`文件超过 ${(spec.maxBytes / 1024 / 1024).toFixed(0)}MB 上限`, 400);
  }

  const dir = templateAssetDir(params.id);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${kind}.${safeExt(file.name, spec.fallbackExt)}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));

  await prisma.videoTemplate.update({
    where: { id: params.id },
    data: { [spec.field]: dest, updatedAt: new Date().toISOString() },
  });
  return ok({ [spec.field]: dest });
}
```

- [ ] **Step 7: 运行素材测试确认通过**

Run: `npx vitest run tests/api/video-templates/`
Expected: PASS(19 个用例)

- [ ] **Step 8: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/video-template/store.ts src/app/api/v1/video-templates tests/api/video-templates
git commit -m "feat(video-template): 二十期 — 模板 CRUD/复制/素材上传 API + 预设播种"
```

---

### Task 8: 写稿 prompt 注入模板提示

**Files:**
- Modify: `src/lib/llm/prompts/script-write-douyin.ts`
- Test: `tests/lib/prompts/script-write-douyin-template.test.ts`

**Interfaces:**
- Produces:
  - `function buildTemplateSection(scriptPrompt: VideoTemplateConfig['scriptPrompt']): string` — 无配置时返回空串
  - `SCRIPT_WRITE_DOUYIN.buildSystemPrompt(niche, style, personaSection?, voiceSection?, templateSection?)` — 第 5 个可选参数

**关键约束**:不传 `templateSection`(或传空串)时,输出必须与改动前**字符级一致**——这是十二/十三期反复确认过的零迁移铁律,现有测试会守住。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/prompts/script-write-douyin-template.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SCRIPT_WRITE_DOUYIN, buildTemplateSection } from '@/lib/llm/prompts/script-write-douyin';
import { getStyleContext } from '@/lib/script/style';

// 与现有 script-write-douyin 测试同一套最小 StyleContext 构造
const STYLE = { hasProfile: false, samples: [], tone: '', vocabulary: [], sentencePattern: '', taboo: [] } as any;

describe('buildTemplateSection', () => {
  it('无配置 → 空串(不传/传 null 都是)', () => {
    expect(buildTemplateSection(null)).toBe('');
    expect(buildTemplateSection({})).toBe('');
  });

  it('语气写进提示', () => {
    const s = buildTemplateSection({ tone: '轻松吐槽' });
    expect(s).toContain('轻松吐槽');
  });

  it('钩子套路写进提示', () => {
    const s = buildTemplateSection({ hookHint: '用反常识数字开场' });
    expect(s).toContain('用反常识数字开场');
  });

  it('额外要求写进提示', () => {
    const s = buildTemplateSection({ extraGuidance: '每幕结尾留一个悬念' });
    expect(s).toContain('每幕结尾留一个悬念');
  });

  it('多项配置同时出现', () => {
    const s = buildTemplateSection({ tone: 'A语气', hookHint: 'B钩子', extraGuidance: 'C要求' });
    expect(s).toContain('A语气');
    expect(s).toContain('B钩子');
    expect(s).toContain('C要求');
  });
});

describe('SCRIPT_WRITE_DOUYIN.buildSystemPrompt 模板注入', () => {
  it('不传 templateSection 时与传空串字符级一致(零迁移)', () => {
    const without = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE);
    const withEmpty = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', '');
    expect(withEmpty).toBe(without);
  });

  it('传了 templateSection 时内容出现在 prompt 里', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', buildTemplateSection({ tone: '冷幽默' }));
    expect(p).toContain('冷幽默');
  });

  it('模板提示不影响六幕结构等既有硬性要求仍在', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('AI', STYLE, '', '', buildTemplateSection({ tone: '冷幽默' }));
    expect(p).toContain('六幕结构与职责');
    expect(p).toContain('科普严谨性');
  });
});
```

**注意**:`STYLE` 的真实形状要照 `src/lib/script/style.ts` 里 `StyleContext` 的定义来——实现时先 `grep -n "interface StyleContext" -A 12 src/lib/script/style.ts` 确认字段,用真实字段构造(上面是占位形状,必须替换成真实的)。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/lib/prompts/script-write-douyin-template.test.ts`
Expected: FAIL — `buildTemplateSection` 未导出

- [ ] **Step 3: 写实现**

在 `src/lib/llm/prompts/script-write-douyin.ts` 的 `buildStyleSection` 附近加:

```typescript
/**
 * 二十期: 模板写稿提示注入段。无配置时返回空串 —— buildSystemPrompt 在空串时
 * 输出与不传参数**字符级一致**(与 personaSection/voiceSection 同一约定, 零迁移)。
 */
export function buildTemplateSection(
  scriptPrompt: { tone?: string; targetDurationSec?: number; hookHint?: string; extraGuidance?: string } | null,
): string {
  if (!scriptPrompt) return '';
  const lines: string[] = [];
  if (scriptPrompt.tone?.trim()) lines.push(`- 整体语气: ${scriptPrompt.tone.trim()}`);
  if (scriptPrompt.hookHint?.trim()) lines.push(`- 开场钩子套路: ${scriptPrompt.hookHint.trim()}`);
  if (scriptPrompt.extraGuidance?.trim()) lines.push(`- 额外要求: ${scriptPrompt.extraGuidance.trim()}`);
  if (lines.length === 0) return '';
  return `\n\n本条内容套用的模板对写稿有额外要求 (与上面的通用规则冲突时, 以上面的硬性要求为准):\n${lines.join('\n')}`;
}
```

修改 `buildSystemPrompt` 签名与拼接(注意 `templateBlock` 拼在 `voiceBlock` 之后、任务描述之前,与既有两块同一位置约定):

```typescript
  buildSystemPrompt(
    niche: string,
    style: StyleContext,
    personaSection?: string,
    voiceSection?: string,
    templateSection?: string,
  ): string {
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona ? `\n\n你的定位:\n${personaSection}` : '';
    const voiceBlock = voiceSection && voiceSection.trim() ? voiceSection : '';
    // 二十期: 模板写稿提示 —— 空串时与不传参数字符级一致(同 personaSection/voiceSection 约定)
    const templateBlock = templateSection && templateSection.trim() ? templateSection : '';
    return `${getExpertPersona(niche)}${personaBlock}${voiceBlock}${templateBlock}

任务: 为这条抖音口播短视频写一份可以直接照着念的口播逐字稿, ...
```

(其余正文保持原样不动。)

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/lib/prompts/`
Expected: PASS——**包括既有的 script-write-douyin 测试**(零迁移断言必须仍然绿)

- [ ] **Step 5: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/lib/llm/prompts/script-write-douyin.ts tests/lib/prompts/script-write-douyin-template.test.ts
git commit -m "feat(prompts): 二十期 — 六幕写稿 prompt 支持模板写稿提示注入(空串零迁移)"
```

---

### Task 9: 文案生成 API + 出片发起 API

**Files:**
- Create: `src/app/api/v1/video-templates/[id]/script/route.ts`
- Create: `src/app/api/v1/video-templates/[id]/produce/route.ts`
- Test: `tests/api/video-templates/script.test.ts`、`tests/api/video-templates/produce.test.ts`

**Interfaces:**
- Consumes: `buildTemplateSection`(T8)、`SCRIPT_WRITE_DOUYIN`、`synthesizeSrtFromSixActScript`、`allocateActSeconds`(`six-act.ts:140`)、`videoProductionQueue`
- Produces:
  - `POST /script` body `{ source: 'paste'|'inspiration', text?: string, inspirationId?: string }` → `{ script: { acts, four_dims, ... } }`(**不落库**)
  - `POST /produce` body `{ contentId?: string, script?: SixActScript, title?: string, voiceOverride?: { voiceType?: string } }` → `{ videoProductionId, status }`

**关键语义**:
- `/produce` 传 `contentId` = 用已有内容卡;传 `script` = 自动建卡(建卡后走 `linkCockpitContent` 同款关联 + `bumpCockpitRev`)。
- 真人出镜模式**不立即入队**(等 upload-source 触发),与十九期现有节奏一致。

- [ ] **Step 1: 写 /produce 失败测试**

创建 `tests/api/video-templates/produce.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitContent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn(), create: vi.fn() },
  videoProduction: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

const bumpMock = vi.hoisted(() => ({ bumpCockpitRev: vi.fn(async () => undefined) }));
vi.mock('@/lib/cockpit/server-store', () => bumpMock);

vi.mock('fs/promises', () => {
  const m = { mkdir: vi.fn(async () => undefined) };
  return { default: m, ...m };
});

import { POST } from '@/app/api/v1/video-templates/[id]/produce/route';

const SIX_ACT = {
  acts: ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'].map((act) => ({
    act,
    title: `${act} 标题`,
    narration: `${act} 的台词内容, 足够长以通过校验。`,
    visual: '画面描述',
    note: '备注',
    targetSec: 15,
    beats: [{ keyword: 'k1' }, { keyword: 'k2' }, { keyword: 'k3' }],
    facts: [],
  })),
  four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration', voicePreset: null,
  });
  prismaMock.videoProduction.create.mockImplementation(async ({ data }: any) => data);
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/v1/video-templates/[id]/produce', () => {
  it('传 contentId 且该内容已有六幕定稿 → 直接建生成任务, 带上 templateId', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'd1',
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: JSON.stringify(SIX_ACT) });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.templateId).toBe('t1');
    expect(created.contentId).toBe('c1');
    expect(created.mode).toBe('ppt-narration');
    expect(created.srt.length).toBeGreaterThan(0);
    // 非真人出镜模式立即入队
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it('传 script(粘贴/灵感出稿) → 自动建内容卡并关联六幕稿', async () => {
    prismaMock.cockpitContent.create.mockResolvedValue({ id: 'newc1', userId: 'user1' });
    prismaMock.scriptDraft.create.mockResolvedValue({ id: 'newd1' });

    const res = await POST(req({ script: SIX_ACT, title: '我的新内容' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledTimes(1);
    // 建卡后必须关联 scriptDraftId, 否则 worker 找不到六幕稿
    expect(prismaMock.cockpitContent.update).toHaveBeenCalled();
    expect(prismaMock.cockpitContent.update.mock.calls[0][0].data.scriptDraftId).toBe('newd1');
    // 服务端直写 cockpit 数据必须 bump rev, 否则前端读脏缓存
    expect(bumpMock.bumpCockpitRev).toHaveBeenCalledWith('user1');
    // 新卡的 deliveryMode 跟随模板
    expect(prismaMock.cockpitContent.create.mock.calls[0][0].data.deliveryMode).toBe('ppt-narration');
  });

  it('真人出镜模板: 建任务但不立即入队(等上传视频后触发)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'talking-head-broll', voicePreset: null,
    });
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: JSON.stringify(SIX_ACT) });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.create).toHaveBeenCalledTimes(1);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('内容没有六幕定稿 → 400, 不建任务', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: null });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });

  it('模板归属别的用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('内容归属别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other', scriptDraftId: 'd1' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('既没传 contentId 也没传 script → 400', async () => {
    const res = await POST(req({}) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  it('script 形状不是合法六幕 → 400', async () => {
    const res = await POST(req({ script: { acts: [] } }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/api/video-templates/produce.test.ts`
Expected: FAIL — 路由不存在

- [ ] **Step 3: 写 /produce 路由**

创建 `src/app/api/v1/video-templates/[id]/produce/route.ts`:

```typescript
import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { SixActScriptSchema } from '@/lib/script/six-act';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

/**
 * 模板页发起出片(二十期)。两种入口:
 * - `contentId`: 用已有内容卡的六幕定稿;
 * - `script`: 粘贴/灵感出稿确认后的六幕稿 —— 自动建一张内容卡再发起, 让成片天然进入
 *   现有内容总览与复盘闭环(spec §2.5), 而不是另起一套平行体系。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { contentId?: unknown; script?: unknown; title?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }

  const user = await getOrCreateDefaultUser();
  const template = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!template || template.userId !== user.id) return fail('模板不存在', 404);

  let contentId: string;
  let acts: ReturnType<typeof parseDraftOutput> extends infer T ? any : never;

  if (typeof body.contentId === 'string' && body.contentId) {
    const content = await prisma.cockpitContent.findUnique({ where: { id: body.contentId } });
    if (!content || content.userId !== user.id) return fail('内容不存在', 404);
    const draft = content.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) return fail('需要先生成六幕脚本', 400);
    contentId = content.id;
    acts = parsed.acts;
  } else if (body.script) {
    const parsed = SixActScriptSchema.safeParse(body.script);
    if (!parsed.success) return fail('六幕脚本形状不合法', 400);
    const now = new Date().toISOString();
    const newContentId = randomUUID();
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名内容';

    const content = await prisma.cockpitContent.create({
      data: {
        id: newContentId,
        userId: user.id,
        title,
        platform: 'douyin',
        deliveryMode: template.deliveryMode,
        stage: 'script',
        topic: {},
        script: {},
        metrics: {},
        review: {},
        createdAt: now,
        updatedAt: now,
      },
    });
    const draft = await prisma.scriptDraft.create({
      data: {
        userId: user.id,
        platform: 'douyin',
        output: JSON.stringify(parsed.data),
      } as never,
    });
    await prisma.cockpitContent.update({
      where: { id: content.id },
      data: { scriptDraftId: draft.id, updatedAt: new Date().toISOString() },
    });
    // 服务端直写 cockpit 数据必须 bump rev, 否则前端读到脏缓存(既有教训)。
    await bumpCockpitRev(user.id);

    contentId = content.id;
    acts = parsed.data.acts;
  } else {
    return fail('需要 contentId 或 script', 400);
  }

  const srt = synthesizeSrtFromSixActScript(acts);
  const id = randomUUID().slice(0, 12);
  const productionRoot = path.join(process.env.VIDEO_PRODUCTION_ROOT || './video-productions', id);
  await fs.mkdir(productionRoot, { recursive: true });

  const now = new Date().toISOString();
  const vp = await prisma.videoProduction.create({
    data: {
      id,
      userId: user.id,
      contentId,
      templateId: template.id,
      mode: template.deliveryMode,
      srt,
      productionRoot,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    },
  });

  // 真人出镜模式先不入队 —— 等 upload-source 落地 sourceVideoPath 后再触发,
  // 避免 worker 在视频还没上传时立即失败(与十九期既有节奏一致)。
  if (template.deliveryMode !== 'talking-head-broll') {
    await videoProductionQueue.add('produce', { videoProductionId: id, mode: 'preview' });
  }

  return ok({ videoProductionId: vp.id, status: vp.status, contentId });
}
```

**实现注意**:`prisma.scriptDraft.create` 的 `data` 形状必须照 `prisma/schema.prisma:94` 的 `ScriptDraft` model 真实必填字段填全(上面用了 `as never` 占位,**实现时必须先 `sed -n '94,117p' prisma/schema.prisma` 看真实字段并写全**,不许保留 `as never`)。同理 `cockpitContent.create` 的必填 Json 字段(`topic`/`script`/`metrics`/`review`)要与既有创建路径填的默认结构一致——参照 `src/lib/cockpit/server-store.ts` 里 `saveWorkspaceToDb` 的写法。

- [ ] **Step 4: 运行 produce 测试确认通过**

Run: `npx vitest run tests/api/video-templates/produce.test.ts`
Expected: PASS(8 个用例)

- [ ] **Step 5: 写 /script 测试**

创建 `tests/api/video-templates/script.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitInspiration: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class { callStructured = llmMock.callStructured; },
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'key') }));
vi.mock('@/lib/script/style', () => ({ getStyleContext: vi.fn(async () => ({ hasProfile: false, samples: [] })) }));

import { POST } from '@/app/api/v1/video-templates/[id]/script/route';

const RESULT = { acts: [], four_dims: {} };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration',
    scriptPrompt: { tone: '冷幽默', targetDurationSec: 60 },
  });
  llmMock.callStructured.mockResolvedValue({ result: RESULT });
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/v1/video-templates/[id]/script', () => {
  it('粘贴模式: 用粘贴的文本当主题写六幕稿, 返回但不落库', async () => {
    const res = await POST(req({ source: 'paste', text: '我想讲讲向量数据库为什么被高估了' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.data.script).toEqual(RESULT);
  });

  it('模板的写稿提示注入进 systemPrompt', async () => {
    await POST(req({ source: 'paste', text: '某个主题内容' }) as any, { params: { id: 't1' } });
    const call = llmMock.callStructured.mock.calls[0][0];
    expect(call.systemPrompt).toContain('冷幽默');
  });

  it('模板的目标时长驱动各幕秒数分配', async () => {
    await POST(req({ source: 'paste', text: '某个主题内容' }) as any, { params: { id: 't1' } });
    const call = llmMock.callStructured.mock.calls[0][0];
    const text = JSON.stringify(call.userMessage);
    expect(text).toContain('60');
  });

  it('灵感模式: 用灵感文本当主题', async () => {
    prismaMock.cockpitInspiration.findUnique.mockResolvedValue({ id: 'i1', userId: 'user1', text: '灵感原文' });

    const res = await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const text = JSON.stringify(llmMock.callStructured.mock.calls[0][0].userMessage);
    expect(text).toContain('灵感原文');
  });

  it('灵感归属别的用户 → 404', async () => {
    prismaMock.cockpitInspiration.findUnique.mockResolvedValue({ id: 'i1', userId: 'other', text: 'x' });
    const res = await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('非法 source → 400', async () => {
    const res = await POST(req({ source: 'whatever' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  it('粘贴模式但文本太短 → 400', async () => {
    const res = await POST(req({ source: 'paste', text: '短' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 写 /script 路由**

创建 `src/app/api/v1/video-templates/[id]/script/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_WRITE_DOUYIN, buildTemplateSection } from '@/lib/llm/prompts/script-write-douyin';
import { getStyleContext } from '@/lib/script/style';
import { allocateActSeconds } from '@/lib/script/six-act';

/**
 * 模板页文案生成(二十期): 粘贴的一段文字 / 一条灵感 → 按模板写稿提示产出六幕稿。
 * **不落库** —— 用户在向导里确认后由 /produce 统一建卡, 避免"点了生成就冒出一堆
 * 半成品内容卡"污染内容总览。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { source?: unknown; text?: unknown; inspirationId?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }

  const user = await getOrCreateDefaultUser();
  const template = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!template || template.userId !== user.id) return fail('模板不存在', 404);

  let topic: string;
  if (body.source === 'paste') {
    if (typeof body.text !== 'string' || body.text.trim().length < 5) {
      return fail('粘贴的文案太短, 至少 5 个字', 400);
    }
    topic = body.text.trim();
  } else if (body.source === 'inspiration') {
    if (typeof body.inspirationId !== 'string') return fail('缺少 inspirationId', 400);
    const insp = await prisma.cockpitInspiration.findUnique({ where: { id: body.inspirationId } });
    if (!insp || insp.userId !== user.id) return fail('灵感不存在', 404);
    topic = insp.text;
  } else {
    return fail('source 必须是 paste 或 inspiration', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 400);

  const scriptPrompt = (template.scriptPrompt ?? null) as
    | { tone?: string; targetDurationSec?: 30 | 45 | 60 | 90; hookHint?: string; extraGuidance?: string }
    | null;
  const durationSec = scriptPrompt?.targetDurationSec ?? 90;
  const style = await getStyleContext(user.id, 'douyin');

  const llm = new DeepSeekTextLLM({ apiKey, defaultModel: 'deepseek-reasoner' });
  const { result } = await llm.callStructured({
    systemPrompt: SCRIPT_WRITE_DOUYIN.buildSystemPrompt(
      '', style, '', '', buildTemplateSection(scriptPrompt),
    ),
    userMessage: SCRIPT_WRITE_DOUYIN.buildUserMessage({
      topic,
      durationSec,
      brief: null,
      actSeconds: allocateActSeconds(durationSec),
    }),
    responseSchema: SCRIPT_WRITE_DOUYIN.responseSchema,
  });

  return ok({ script: result });
}
```

**实现注意**:`SCRIPT_WRITE_DOUYIN.buildSystemPrompt` 的第一个参数 `niche` 在现有 `/scripts/generate` 路由里有真实取值来源(见 `src/app/api/v1/scripts/generate/route.ts:163` 附近)——实现时照那里取同样的 niche,不要传空串。同样地,人设/人物志两段(`buildPersonaSection`/`buildVoiceSection`)在 `/scripts/generate` 里是必注入的,这里也应照搬,保持模板出稿与正常写稿的人格一致。

- [ ] **Step 7: 运行 script 测试确认通过**

Run: `npx vitest run tests/api/video-templates/`
Expected: PASS(全部 34 个用例)

- [ ] **Step 8: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/app/api/v1/video-templates tests/api/video-templates
git commit -m "feat(video-template): 二十期 — 模板文案生成 + 出片发起 API(自动建卡)"
```

---

### Task 10: 模板页前端

**Files:**
- Create: `src/components/cockpit/views/templates.tsx`
- Modify: `src/lib/cockpit/view-routing.ts`、`src/components/cockpit/sidebar.tsx`、`src/components/cockpit/Cockpit.tsx`
- Test: `tests/components/cockpit/templates-view.test.tsx`、`tests/components/cockpit/sidebar.test.ts`(补充)

**Interfaces:**
- Consumes: 全部 `/api/v1/video-templates*` 路由(T7/T9)、`VideoProductionPanel`(`src/components/cockpit/video-production-panel.tsx`,props `{ contentId, deliveryMode }`)
- Produces:`export function TemplatesView(): JSX.Element`

- [ ] **Step 1: 写侧栏导航失败测试**

在 `tests/components/cockpit/sidebar.test.ts` 追加:

```typescript
import { ALL_NAV_ITEMS } from '@/components/cockpit/sidebar';

describe('模板导航项(二十期)', () => {
  it('ALL_NAV_ITEMS 含「模板」项', () => {
    const item = ALL_NAV_ITEMS.find((i) => i.id === 'templates');
    expect(item).toBeDefined();
    expect(item!.label).toBe('模板');
  });
});
```

同时在 `tests/lib/cockpit/view-routing.test.ts`(若不存在则新建)加:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveInitialView } from '@/lib/cockpit/view-routing';

describe('templates 视图路由(二十期)', () => {
  it('?view=templates 能解析到 templates 视图', () => {
    expect(resolveInitialView(new URLSearchParams('view=templates'))).toBe('templates');
  });
});
```

**注意**:`resolveInitialView` 的真实签名要先 `grep -n "resolveInitialView" -A 8 src/lib/cockpit/view-routing.ts` 确认(它接收的可能是 `ReadonlyURLSearchParams` 或别的形状),按真实签名写测试。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/cockpit/sidebar.test.ts`
Expected: FAIL — 找不到 `templates` 导航项

- [ ] **Step 3: 加导航与路由**

`src/lib/cockpit/view-routing.ts`:`NavView` 联合类型加 `| "templates"`;`FIXED_VIEW_IDS` 数组加 `"templates"`。

`src/components/cockpit/sidebar.tsx`:在 `OVERVIEW_NAV_ITEMS` 里(内容数据分析之前)加:

```typescript
  { id: "templates", label: "模板", icon: "template" },
```

若 `Icon` 组件没有 `template` 图标,复用一个已有的近义图标名(先 `grep -n "case \"" src/components/cockpit/shared.tsx | head -30` 看可用图标名,选一个合适的,不要引用不存在的图标)。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/components/cockpit/sidebar.test.ts tests/lib/cockpit/`
Expected: PASS

- [ ] **Step 5: 写模板页组件失败测试**

创建 `tests/components/cockpit/templates-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

// 生成进度面板已有独立测试, 这里 mock 掉只验证"传了什么 props"
vi.mock('@/components/cockpit/video-production-panel', () => ({
  VideoProductionPanel: (props: { contentId: string; deliveryMode: string }) => (
    <div data-testid="mock-panel" data-content={props.contentId} data-mode={props.deliveryMode} />
  ),
}));

import { TemplatesView } from '@/components/cockpit/views/templates';

const TEMPLATES = [
  {
    id: 't1', name: '图文口播', description: '', deliveryMode: 'ppt-narration',
    visualStyle: 'card', palette: null, voicePreset: null, scriptPrompt: null,
    captionStyle: null, bgmPath: null, bgmVolume: 0.15, introPath: null, outroPath: null, isPreset: true,
  },
  {
    id: 't2', name: '真人出镜 + B-roll', description: '', deliveryMode: 'talking-head-broll',
    visualStyle: 'card', palette: null, voicePreset: null, scriptPrompt: null,
    captionStyle: null, bgmPath: null, bgmVolume: 0.12, introPath: null, outroPath: null, isPreset: true,
  },
];

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return {
      ok: true,
      json: async () => ({ ok: true, data: key ? routes[key] : {} }),
    } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch({ '/api/v1/video-templates': { templates: TEMPLATES } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TemplatesView', () => {
  it('加载后列出全部模板', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());
    expect(screen.getByText('真人出镜 + B-roll')).toBeTruthy();
  });

  it('预设模板带徽标', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getAllByText('预设').length).toBe(2));
  });

  it('点「用它出片」进入出片向导第一步(定文案)', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);

    expect(screen.getByText(/定文案/)).toBeTruthy();
  });

  it('出片向导对真人出镜模板显示上传素材步骤, 对图文口播不显示', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    // 图文口播: 无上传步骤
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[0]);
    expect(screen.queryByText(/上传出镜视频/)).toBeNull();

    // 退回列表, 换真人出镜模板
    fireEvent.click(screen.getByRole('button', { name: '返回模板列表' }));
    await waitFor(() => expect(screen.getByText('真人出镜 + B-roll')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: '用它出片' })[1]);
    expect(screen.getByText(/上传出镜视频/)).toBeTruthy();
  });

  it('点「编辑」打开编辑器并回填该模板的值', async () => {
    render(<TemplatesView />);
    await waitFor(() => expect(screen.getByText('图文口播')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    const nameInput = screen.getByLabelText('模板名称') as HTMLInputElement;
    expect(nameInput.value).toBe('图文口播');
  });
});
```

- [ ] **Step 6: 运行确认失败**

Run: `npx vitest run tests/components/cockpit/templates-view.test.tsx`
Expected: FAIL — 组件不存在

- [ ] **Step 7: 写模板页组件**

创建 `src/components/cockpit/views/templates.tsx`,实现三块(列表 / 编辑器 / 出片向导),要求:

- 顶层用一个 `mode` 状态在 `'list' | 'edit' | 'produce'` 之间切换,每种模式渲染对应子区。
- **列表**:`useEffect` 拉 `GET /api/v1/video-templates`,每张卡显示 `name`、交付模式中文名、`isPreset` 时显示「预设」徽标,四个按钮:`用它出片` / `编辑` / `复制` / `删除`(删除前 `window.confirm`)。
- **编辑器**:表单字段与 `VideoTemplateConfig` 一一对应;`模板名称` 输入框必须带 `aria-label="模板名称"`(测试依赖);字幕字体用 `CAPTION_FONT_WHITELIST` 渲染成 select;BGM/片头/片尾各一个 `<input type="file">`,选中后 `POST .../assets`(FormData 带 `kind` 与 `file`);保存走 `PUT .../[id]` 或 `POST /api/v1/video-templates`。
- **出片向导**:步骤条 + 当前步渲染。
  - 步骤 1「定文案」:三个 tab(选已定稿 / 粘贴新写 / 从灵感出稿)。后两种点生成调 `POST .../script`,把返回的六幕稿渲染成预览(逐幕 title + narration),带「重新生成」与「用这稿继续」。
  - 步骤 2「上传出镜视频」:**仅** `deliveryMode === 'talking-head-broll'` 时出现。
  - 步骤 3「确认配音」:**仅** `deliveryMode === 'illustration-tts'` 时出现,带出模板 `voicePreset` 允许临时改。
  - 步骤 4「生成与审片」:调 `POST .../produce`,拿到 `contentId` 后渲染 `<VideoProductionPanel contentId={...} deliveryMode={...} />`;真人出镜模板在此之前先把上传的视频 `POST /api/v1/cockpit/video-productions/[id]/upload-source`。
  - 顶部始终有一个 `返回模板列表` 按钮(测试依赖该 accessible name)。
- 页面底部:该模板的历史出片列表(状态 + 成片下载链接)。

样式沿用 cockpit 既有 class(先看 `src/components/cockpit/views/positioning.tsx` 之类同级视图的写法,复用同款卡片/表单 class,不要新造一套设计语言)。

- [ ] **Step 8: 运行组件测试确认通过**

Run: `npx vitest run tests/components/cockpit/templates-view.test.tsx`
Expected: PASS(5 个用例)

- [ ] **Step 9: 挂载到 Cockpit**

`src/components/cockpit/Cockpit.tsx`:顶部加 `import { TemplatesView } from "./views/templates";`,并在视图分发处(约 685 行 `analytics` 那一行附近)加:

```tsx
          {view === "templates" ? <TemplatesView /> : null}
```

- [ ] **Step 10: 全量验证并提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/components/cockpit src/lib/cockpit/view-routing.ts tests/components/cockpit tests/lib/cockpit
git commit -m "feat(cockpit): 二十期 — 模板页(列表/编辑器/出片向导) + 侧栏导航接入"
```

---

### Task 11: 真实 E2E 走查 + 文档

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-08-23-video-template-design.md` 的「实施记录」段(追加到文末)

- [ ] **Step 1: 起本地环境**

```bash
npm run dev        # 站点 http://localhost:3000
npm run worker:dev # 另开一个终端: 雷达/生成 worker
```

**注意**:worker 是长驻进程无热重载,改过 worker 代码必须重启(既有教训,README §已记)。

- [ ] **Step 2: 走查预设播种与模板编辑**

在浏览器打开 `http://localhost:3000/?view=templates`,确认:
- 首次进入自动出现 3 个预设模板,徽标显示「预设」。
- 刷新页面**不会**变成 6 个(播种幂等)。
- 编辑其中一个:改名、改字幕样式(字号/颜色)、上传一首 BGM(mp3)与一段片头(mp4),保存后刷新页面配置仍在。

- [ ] **Step 3: 走查三种文案来源**

- 「选已定稿」:挑一篇已有六幕定稿的抖音内容,进到生成步骤。
- 「粘贴新写」:粘一段 200 字左右的想法,生成六幕稿预览,确认后**去内容总览确认自动建的卡真的在库里**(这是十四期教训:必须刷新页面查库,不能只看 UI)。
- 「从灵感出稿」:挑一条灵感,同样确认建卡落库。

- [ ] **Step 4: 三个预设模板各真实出一条片**

- **图文口播**:走完整流程到成片,下载检查——字幕样式是否按模板生效、BGM 是否在、片头是否接上。
- **插画配音**:需先在设置页配好火山 TTS。真实调用出片,检查配音+插画+字幕+BGM+片头。
- **真人出镜**:用一段真实手机拍的口播视频(竖屏 `.mov` 最好,能同时验证十九期的多音轨/尺寸兼容),检查 B-roll 挖空、真实原话字幕的**样式**是否按模板生效(而不是旧的默认样式)、包装三件套是否都在。

每条片子记录:成片时长是否合理、有无音画错位、包装是否重复(比如双层字幕)。

- [ ] **Step 5: 验证零迁移**

从**内容详情页**(不是模板页)发起一次生成,确认:
- 任务 `templateId` 为空;
- 成片行为与十九期完全一致(真人出镜仍烧默认样式字幕,无 BGM 无片头);
- 不会因为包装段报错。

- [ ] **Step 6: 修复走查中发现的问题**

任何问题都按 TDD 修:先写复现的失败测试,再改实现。E2E 阶段发现的 bug 是最有价值的(十三/十四/十九期都在这一步抓到过真 bug),不要跳过写测试直接改。

- [ ] **Step 7: 更新 README**

在 README 中:
- 功能列表加「模板」板块(三预设、模板驱动出片、包装三件套)。
- 环境变量段加 `VIDEO_TEMPLATE_ROOT`(默认 `./video-templates`)。
- 目录结构段补 `src/lib/video-template/`、`src/lib/video-production/{ass-captions,packaging,packaging-input}.ts`、`src/app/api/v1/video-templates/`、`src/components/cockpit/views/templates.tsx`。
- 已知限制段补:`.ass` 字幕字体依赖渲染机器已装(白名单为 macOS 自带中文字体);BGM 无自动闪避;预览阶段不包装。

- [ ] **Step 8: 在 spec 末尾追加实施记录**

在 `docs/superpowers/specs/2026-08-23-video-template-design.md` 末尾追加一段「## 9. 实施记录」,写明:实际改动与设计的偏差、E2E 抓到的真实 bug 及修复、遗留 minor。

- [ ] **Step 9: 最终验证并提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿

```bash
git add README.md docs/superpowers/specs/2026-08-23-video-template-design.md
git commit -m "docs(video-template): 二十期收尾 — 三预设模板真实 E2E 走查 + README 对齐"
```

---

## 自审记录

- **spec 覆盖**:§2 数据模型→T1;§2.3 素材存储→T7;§2.4 播种→T1(定义)+T7(执行);§2.5 内容归属→T9;§3.2 字幕→T2+T5;§3.3 BGM→T3;§3.4 片头片尾→T4;§3.1 位置/失败处置→T5+T6;§3.5 代码落点→T2/T5/T6;§4 API→T7+T9;§5 UI→T10;§6 测试→各 Task 内建 + T11;§7 范围外→无任务(正确);§8 风险→T2(字体白名单)/T5(中间产物)/T4(不用 copy)/T9(建卡走 bumpCockpitRev)。
- **占位符扫描**:无 TBD/TODO。三处标了「实现时先 grep 确认真实字段」的地方(`DirectorResponse.shot` 文本字段、`ScriptDraft`/`CockpitContent` 必填字段、`StyleContext` 形状、`resolveInitialView` 签名、Icon 图标名)是**有意为之**的核对指令,附了具体命令和不满足时的处理方式,不是含糊的"自行处理"。
- **类型一致性**:`CaptionEvent`(T2 定义)在 T5/T6 一致使用;`PackagingOptions`(T5)被 T6 的 `buildPackagingOptions` 返回;`CaptionStyle`(T1)贯穿 T2/T5/T6;`burnCaptions` 的 `format` 参数在 T5 定义并在同一 Task 内被 packaging 消费;`templateAssetDir`/`newTemplateId`(T7 store)被 T7 的四个路由共用。
