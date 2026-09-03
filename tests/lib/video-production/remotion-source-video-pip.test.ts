import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderFilm } from '@/lib/video-production/remotion-render';
import { extractSingleFrame } from '@/lib/video/ffmpeg';
import { THEMES } from '../../../remotion/src/theme';
import { parsePpm, readPixel, hexToRgb, manhattan } from './_ppm-test-utils';

/*
 * 二十九期 Task 3: 出镜视频层, pip(画中画)版式。
 *
 * 独立成单独的测试文件而不是并进 cutaway 那份——见
 * `remotion-source-video-cutaway.test.ts` 顶部注释: `@remotion/bundler` 的
 * `bundle()` 只在进程内第一次调用时把 `remotion/public/` 拷进临时目录一次,
 * 同一进程里先后两次"新拷贝出镜视频 + 成功渲染"会让第二次 404。vitest 默认
 * 按文件隔离模块状态, 分文件能让 cutaway/pip 各自的渲染都发生在"进程内第一次
 * 成功渲染"这个位置, 不用改动 `getBundle()` 的缓存策略。
 */

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

let sourceVideoPath: string;

beforeAll(() => {
  sourceVideoPath = path.join(os.tmpdir(), `source-video-pip-src-${Date.now()}.mp4`);
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    sourceVideoPath,
  ]);
}, 30_000);

afterAll(() => {
  if (fs.existsSync(sourceVideoPath)) fs.unlinkSync(sourceVideoPath);
});

describe('出镜视频层: pip 版式', () => {
  const outputPath = path.join(os.tmpdir(), `source-video-pip-out-${Date.now()}.mp4`);
  const fps = 15;

  afterAll(() => {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  it(
    '角标区域像素 ≠ 卡片背景色(视频真的铺在那里)',
    async () => {
      const compositionWidth = 1920;
      const compositionHeight = 1080;
      const pipScale = 0.3;
      const pipMargin = 20;

      await renderFilm({
        input: {
          shots: [
            { shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '画中画卡片' } },
          ],
          audioSrc: null,
          bgm: null,
          captions: [],
          aspect: '16:9',
          visualStyle: 'card',
          sourceVideo: { src: '', layout: 'pip', pip: { position: 'br', scale: pipScale, margin: pipMargin } },
        },
        outputPath,
        durationInFrames: 2 * fps,
        fps,
        sourceVideoFile: sourceVideoPath,
      });

      expect(fs.existsSync(outputPath)).toBe(true);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-frame-'));
      try {
        const ppmPath = path.join(tmpDir, 'frame.ppm');
        await extractSingleFrame({ videoPath: outputPath, timestampSec: 1.0, outputPath: ppmPath });
        const ppm = parsePpm(fs.readFileSync(ppmPath));

        // pip 矩形: 宽 = 画面宽 * scale, 高按源视频宽高比(640x360 => 0.5625)反算
        // (Film.tsx 里没有写死高度, 靠 <img> 只设 width 时浏览器按视频真实宽高比
        // 自动算 height, 这里手工复算同一条比例来定位采样点), br 定位——与
        // Film.tsx PIP_POSITION_STYLE/宽度计算逐字段对齐。
        const rectWidth = Math.round(compositionWidth * pipScale);
        const rectHeight = Math.round(rectWidth * (360 / 640));
        const rectX = compositionWidth - rectWidth - pipMargin;
        const rectY = compositionHeight - rectHeight - pipMargin;
        // 取矩形内部一点(离边缘留够余量, 避开缩放/编码边缘误差)。
        const sampleX = Math.min(ppm.width - 1, rectX + Math.floor(rectWidth / 2));
        const sampleY = Math.min(ppm.height - 1, rectY + Math.floor(rectHeight / 2));
        const pixel = readPixel(ppm, sampleX, sampleY);

        const paperRgb = hexToRgb(THEMES.card.background);
        expect(manhattan(pixel, paperRgb)).toBeGreaterThan(10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
