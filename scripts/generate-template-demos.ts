/**
 * 模板演示视频生成(三十五期)。
 *
 * 用户反馈: 模板库五张卡片只有名字和一句话, 点进去也不知道这个模板出来的片子
 * 长什么样, 选模板全靠猜。
 *
 * 方案是**真渲染而不是做示意图**: 每套模板用它自己的配置(画幅/视觉风格/出镜
 * 版面/PIP 参数)走与正式出片同一条 Remotion 渲染链, 渲一段 12 秒的演示片 ——
 * 演示与真实出片永远同链, 模板改配置后重跑本脚本, 演示不会说谎。
 *
 * 出镜模板没有真人素材, 用 ffmpeg 造一段**明确标注的灰色渐变占位片**当
 * 人物画面 —— 演示的是"人物画面与知识卡怎么切换"这个版面行为, 不是伪造
 * 一个真人。卡片页对应文案会说明灰色区域是你的口播画面。
 *
 * 文件名带配置指纹: public/template-demos/<模板id>.<hash8>.mp4。
 * 模板页用同一套指纹算法查文件 —— 配置改了指纹就变, 旧演示自动不再显示
 * (宁可显示"演示未生成"也不显示一个和当前配置对不上的演示)。
 *
 * 用法: npm run gen:template-demos   (跑之前确认 worker 没在占用渲染资源)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { renderFilm, type CaptionItem, type FilmInput } from '@/lib/video-production/remotion-render';

const OUT_DIR = path.join(process.cwd(), 'public', 'template-demos');
const DEMO_MS = 12_000;
const FPS = 30;

/** 配置指纹 —— 模板页 demo-url.ts 用同一套算法, 两处必须一致(那边 import 这里)。 */
export function templateDemoHash(t: {
  deliveryMode: string; visualStyle: string | null; aspect: string | null;
  talkingHeadLayout: string | null; pipPosition: string | null;
  pipScale: number | null; pipMargin: number | null;
  defaultShotStyle: unknown;
}): string {
  const key = JSON.stringify([
    t.deliveryMode, t.visualStyle ?? 'card', t.aspect ?? '9:16',
    t.talkingHeadLayout ?? 'cutaway', t.pipPosition ?? 'br', t.pipScale ?? 0.25, t.pipMargin ?? 40,
    t.defaultShotStyle ?? null,
  ]);
  return createHash('sha1').update(key).digest('hex').slice(0, 8);
}

/**
 * 演示分镜。内容是**真实感的样例文案**而不是「这是 XX 卡」的元描述 ——
 * 演示要回答的是"出来的片子长什么样", 元描述回答不了这个。
 * 四镜覆盖四种代表性卡(陈述/数字/清单/曲线), 新老卡都露脸。
 */
const DEMO_SHOTS = [
  { shotId: 'demo-1', startMs: 0, endMs: 3000, card: 'statement',
    slots: { text: '手机电池不耐用？', sub: '先别急着换新机' } },
  { shotId: 'demo-2', startMs: 3000, endMs: 6000, card: 'stat',
    slots: { label: '官方换电池费用', value: 299, prefix: '¥', note: '不到新机价格十分之一' } },
  { shotId: 'demo-3', startMs: 6000, endMs: 9000, card: 'list',
    slots: { title: '高温才是头号杀手', items: ['别边充边玩大型游戏', '暴晒后别立刻充电', '35°C 充电寿命缩短 37%'] } },
  { shotId: 'demo-4', startMs: 9000, endMs: 12000, card: 'curve',
    slots: { label: '循环寿命的进化', points: [
      { at: '2018', value: 300 }, { at: '2021', value: 500 }, { at: '2024', value: 1200 }, { at: '2026', value: 2000 },
    ], suffix: '次' } },
];

/** 出镜链: 只在中段和尾段插卡, 空档露出人物画面 —— 演示的正是这个切换。 */
const DEMO_SHOTS_TALKING_HEAD = [DEMO_SHOTS[1], { ...DEMO_SHOTS[2], startMs: 9000, endMs: 12000 }];

const DEMO_CAPTIONS: CaptionItem[] = [
  { text: '手机用一年半电池就不行了？', startMs: 200, endMs: 2900 },
  { text: '官方换块电池才两三百块', startMs: 3100, endMs: 5900 },
  { text: '真正伤电池的其实是高温', startMs: 6100, endMs: 8900 },
  { text: '新一代电池能用三到四年', startMs: 9100, endMs: 11900 },
];

/** 灰色渐变占位人像片。lavfi gradients 是 ffmpeg 自带滤镜, 不依赖字体/素材。 */
function makePlaceholderPerson(aspect: '16:9' | '9:16'): string {
  const [w, h] = aspect === '16:9' ? [1920, 1080] : [1080, 1920];
  const out = path.join(OUT_DIR, `_placeholder-${aspect.replace(':', 'x')}.mp4`);
  if (fs.existsSync(out)) return out;
  execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi',
    '-i', `gradients=size=${w}x${h}:c0=0x2a2d33:c1=0x15171a:speed=0.02:duration=${DEMO_MS / 1000}:rate=${FPS}`,
    '-pix_fmt', 'yuv420p', '-y', out,
  ]);
  return out;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const templates = await prisma.videoTemplate.findMany({
    select: {
      id: true, name: true, deliveryMode: true, visualStyle: true, aspect: true,
      talkingHeadLayout: true, pipPosition: true, pipScale: true, pipMargin: true,
      defaultShotStyle: true,
    },
  });
  console.log(`${templates.length} 个模板`);

  for (const t of templates) {
    const hash = templateDemoHash(t);
    const outPath = path.join(OUT_DIR, `${t.id}.${hash}.mp4`);
    if (fs.existsSync(outPath) && !process.env.FORCE) {
      console.log(`跳过(已是最新): ${t.name}`);
      continue;
    }
    // 同一模板的旧指纹演示删掉 —— 留着只会误导
    for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.startsWith(`${t.id}.`))) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }

    const aspect = (t.aspect === '16:9' ? '16:9' : '9:16') as '16:9' | '9:16';
    const visualStyle = (t.visualStyle === 'illustration' ? 'illustration' : 'card') as 'card' | 'illustration';
    const isTalkingHead = t.deliveryMode === 'talking-head-broll';

    const input: FilmInput = {
      shots: (isTalkingHead ? DEMO_SHOTS_TALKING_HEAD : DEMO_SHOTS) as unknown[],
      audioSrc: null,
      bgm: null,
      captions: DEMO_CAPTIONS,
      aspect,
      visualStyle,
      templateStyle: (t.defaultShotStyle as FilmInput['templateStyle']) ?? undefined,
      sourceVideo: isTalkingHead
        ? {
            src: '', // renderFilm 拷贝后填
            layout: t.talkingHeadLayout === 'pip' ? 'pip' : 'cutaway',
            pip: t.talkingHeadLayout === 'pip'
              ? {
                  position: (t.pipPosition ?? 'br') as 'tl' | 'tr' | 'bl' | 'br',
                  scale: t.pipScale ?? 0.25,
                  margin: t.pipMargin ?? 40,
                  shape: 'rounded',
                }
              : null,
          }
        : null,
    };

    const started = Date.now();
    await renderFilm({
      input,
      outputPath: outPath,
      durationInFrames: (DEMO_MS / 1000) * FPS,
      fps: FPS,
      sourceVideoFile: isTalkingHead ? makePlaceholderPerson(aspect) : null,
    });
    console.log(`渲好: ${t.name} (${aspect} ${visualStyle}${isTalkingHead ? ` ${t.talkingHeadLayout}` : ''}) ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  await prisma.$disconnect();
}

// 直接执行时才跑(模板页 import templateDemoHash 时不能触发渲染)
if (process.argv[1]?.includes('generate-template-demos')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
