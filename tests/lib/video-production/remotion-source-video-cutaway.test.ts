import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderFilm, copyIntoRenderAssets } from '@/lib/video-production/remotion-render';
import { extractSingleFrame } from '@/lib/video/ffmpeg';
import { THEMES } from '../../../remotion/src/theme';
import { parsePpm, readPixel, hexToRgb, manhattan, meanVolumeDb } from './_ppm-test-utils';

/*
 * 二十九期 Task 3: 出镜视频层——真人出镜视频铺底, 卡片按分镜时间窗覆盖
 * (挖空替换的原生实现), cutaway 版式。
 *
 * **本文件只放一次成功的 renderFilm 调用**(不含 pip 那条)——实测踩过的坑:
 * `getBundle()` 按进程缓存, 而 `@remotion/bundler` 的 `bundle()` 只在**第一次
 * 调用时**把 `remotion/public/` 拷进 webpack 临时目录一次(`copyDir`, 见
 * `@remotion/bundler/dist/bundle.js`), 之后再往 `remotion/public/render-assets/`
 * 里新增的文件不会同步进那份快照。vitest 默认按测试文件隔离 worker/模块状态
 * (`test.isolate` 默认 true), 同一个进程内先后两次「新拷贝文件 + 成功渲染」
 * 会让第二次因为文件不在快照里而 404——真实复现过, 所以 cutaway/pip 分成
 * 两个文件, 各自只触发一次成功的动态资源渲染。**这对生产是个需要记录的风险**:
 * 单 worker 常驻进程如果连续渲染第二条带 sourceVideo(或 audioFile/bgmFile)的
 * 片子, 同样会撞上这个 404——不在本任务范围内修(会改动 `getBundle()` 缓存
 * 策略, 影响 audio/bgm 现有行为), 已写进任务报告留给后续处理。
 *
 * 真渲染理由同 ambient-layer.test.ts/visual-style-theme.test.ts: "画面到底是
 * 卡片色还是视频画面"这类问题只有真的跑一遍 renderMedia 才作数。
 *
 * 测试素材: ffmpeg lavfi 现造一条 6 秒视频, testsrc 画面(色块图案, 与卡片
 * 纸白背景 #f3eeeb 肉眼可辨)+ 440Hz 正弦波音轨(代理"人声", 用于
 * volumedetect 断言能量不塌——与 spike 用同一手法)。
 */

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

let sourceVideoPath: string;

beforeAll(() => {
  sourceVideoPath = path.join(os.tmpdir(), `source-video-cutaway-src-${Date.now()}.mp4`);
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

describe('出镜视频层: cutaway 版式', () => {
  const renderAssetsDir = path.resolve(process.cwd(), 'remotion/public/render-assets');
  const outputPath = path.join(os.tmpdir(), `source-video-cutaway-out-${Date.now()}.mp4`);
  const fps = 15;
  const totalSec = 6;

  afterAll(() => {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  it(
    '1 镜卡片盖 2~4 秒: 窗口内是卡片色、窗口外是出镜视频画面, 覆盖段人声能量不塌; 中转文件渲后已清理',
    async () => {
      await renderFilm({
        input: {
          shots: [
            { shotId: 'a', startMs: 2000, endMs: 4000, card: 'statement', slots: { text: '卡片挖空段' } },
          ],
          audioSrc: null,
          bgm: null,
          captions: [],
          aspect: '16:9',
          visualStyle: 'card',
          sourceVideo: { src: '', layout: 'cutaway', pip: null },
        },
        outputPath,
        durationInFrames: totalSec * fps,
        fps,
        sourceVideoFile: sourceVideoPath,
      });

      expect(fs.existsSync(outputPath)).toBe(true);

      // --- 像素断言: 窗口外(1.0s)应是 testsrc 画面, 窗口内(3.0s)应是卡片纸白色 ---
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutaway-frames-'));
      try {
        const outsidePpmPath = path.join(tmpDir, 'outside.ppm');
        const insidePpmPath = path.join(tmpDir, 'inside.ppm');
        await extractSingleFrame({ videoPath: outputPath, timestampSec: 1.0, outputPath: outsidePpmPath });
        await extractSingleFrame({ videoPath: outputPath, timestampSec: 3.0, outputPath: insidePpmPath });

        const outsidePpm = parsePpm(fs.readFileSync(outsidePpmPath));
        const insidePpm = parsePpm(fs.readFileSync(insidePpmPath));

        // 取画面中心点: cutaway 下卡片窗口内是整幅不透明背景, 中心点必然是背景色;
        // 窗口外中心点落在 testsrc 的色块图案里, 不会恰好等于卡片纸白色。
        const cx = Math.floor(outsidePpm.width / 2);
        const cy = Math.floor(outsidePpm.height / 2);
        const outsidePixel = readPixel(outsidePpm, cx, cy);
        const insidePixel = readPixel(insidePpm, cx, cy);

        // 两处像素肉眼可分(与 visual-style-theme.test.ts 同一阈值取舍: 编码噪声
        // 只有 1~2, 真实内容差异远大于 10)。
        expect(manhattan(outsidePixel, insidePixel)).toBeGreaterThan(10);

        // 窗口内应接近卡片纸白背景色 THEMES.card.background(#f3eeeb)。
        const paperRgb = hexToRgb(THEMES.card.background);
        expect(manhattan(insidePixel, paperRgb)).toBeLessThan(10);

        // 窗口外不应该是卡片纸白色——证明确实是出镜视频画面在露出, 不是碰巧同色。
        expect(manhattan(outsidePixel, paperRgb)).toBeGreaterThan(10);
        // 窗口外也不应该是纯黑——cutaway 顶层背景在 isCutaway 分支下是 '#000'
        // (给出镜视频留黑底/letterbox), 如果 OffthreadVideo 层被误删/不挂载,
        // 窗口外会直接退化成这块纯黑背景, 上面两条"与纸白色不同"的断言反而
        // 依然成立(黑离纸白更远), 抓不住这种回归——这条断言专门堵住它:
        // testsrc 画面中心实测是黄色(255,255,0), 与纯黑距离 510, 远超阈值。
        expect(manhattan(outsidePixel, [0, 0, 0])).toBeGreaterThan(10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      // --- 音频断言: 覆盖段(2~4s)人声能量不塌, 与非覆盖段(0~2s)能量一致 ---
      const coveredDb = meanVolumeDb(outputPath, 2, 2);
      const uncoveredDb = meanVolumeDb(outputPath, 0, 2);
      // 与 spike 结论一致: 覆盖窗口与未覆盖段能量应当接近(容忍 ffmpeg 重编码/
      // Remotion 混音带来的小幅浮动), 而不是覆盖段掉进静音区间。
      expect(Math.abs(coveredDb - uncoveredDb)).toBeLessThan(3);
      expect(coveredDb).toBeGreaterThan(-60); // 远高于数字静音(spike: muted 时 -91dB)

      // --- 中转清理: render-assets/ 下不应残留这条渲染用的中转视频文件 ---
      const remaining = fs.existsSync(renderAssetsDir) ? fs.readdirSync(renderAssetsDir) : [];
      const leaked = remaining.filter((f) => f.includes(path.basename(outputPath, '.mp4')));
      expect(leaked).toEqual([]);
    },
    120_000,
  );

  /*
   * 照例变异(任务原文要求): 把 Film.tsx cutaway 分支里的 `<OffthreadVideo
   * .../>` 临时删掉、重跑本文件。
   *
   * 第一次尝试暴露了断言本身的漏洞: 删掉视频层后窗口外像素退化成 isCutaway
   * 顶层背景色纯黑 `[0,0,0]`, 而"窗口外≠卡片纸白色"这条断言依然成立(黑离
   * 纸白更远, 反而"更通过"了)——变异没有让测试变红, 说明测试本身没抓住这处
   * 回归。补了一条"窗口外≠纯黑"的断言(testsrc 画面中心实测是黄色
   * `[255,255,0]`)后, 重新删除 `<OffthreadVideo>` 复跑: 新断言如期失败
   * (`manhattan(outsidePixel, [0,0,0])` 变成 0, 不再 > 10)。验证完已还原
   * `<OffthreadVideo>`。
   */
});

describe('copyIntoRenderAssets: 出镜视频中转清理(照音频先例)', () => {
  const renderAssetsDir = path.resolve(process.cwd(), 'remotion/public/render-assets');

  it('sourceVideoFile 指向不存在的路径 → 抛错, 且 render-assets/ 无残留文件', async () => {
    const missingVideo = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.mp4`);
    const outputPath = path.join(os.tmpdir(), `source-video-missing-${Date.now()}.mp4`);
    const before = fs.existsSync(renderAssetsDir) ? fs.readdirSync(renderAssetsDir) : [];

    await expect(
      renderFilm({
        input: {
          shots: [{ shotId: 'a', startMs: 0, endMs: 1000, card: 'statement', slots: { text: 'x' } }],
          audioSrc: null,
          bgm: null,
          captions: [],
          aspect: '16:9',
          visualStyle: 'card',
          sourceVideo: { src: '', layout: 'cutaway', pip: null },
        },
        outputPath,
        durationInFrames: 15,
        fps: 15,
        sourceVideoFile: missingVideo,
      }),
    ).rejects.toThrow();

    const after = fs.existsSync(renderAssetsDir) ? fs.readdirSync(renderAssetsDir) : [];
    expect(after).toEqual(before);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('传 sourceVideoFile 但 input.sourceVideo 为 null → 抛错(调用点契约检查)', async () => {
    const outputPath = path.join(os.tmpdir(), `source-video-no-input-${Date.now()}.mp4`);
    await expect(
      renderFilm({
        input: {
          shots: [{ shotId: 'a', startMs: 0, endMs: 1000, card: 'statement', slots: { text: 'x' } }],
          audioSrc: null,
          bgm: null,
          captions: [],
          aspect: '16:9',
          visualStyle: 'card',
          sourceVideo: null,
        },
        outputPath,
        durationInFrames: 15,
        fps: 15,
        sourceVideoFile: sourceVideoPath,
      }),
    ).rejects.toThrow(/sourceVideo/);
  });

  it("两个不同父目录、同名 basename → 派生出不同的中转文件名('video' kind)", () => {
    const cleanup: string[] = [];
    try {
      const srcA = path.join(os.tmpdir(), `render-assets-video-naming-a-${Date.now()}.mp4`);
      const srcB = path.join(os.tmpdir(), `render-assets-video-naming-b-${Date.now()}.mp4`);
      fs.writeFileSync(srcA, 'fake-video-a');
      fs.writeFileSync(srcB, 'fake-video-b');
      cleanup.push(srcA, srcB);

      const outputPathVpA = path.join(os.tmpdir(), 'vp-video-aaaa', 'master.mp4');
      const outputPathVpB = path.join(os.tmpdir(), 'vp-video-bbbb', 'master.mp4');

      const destA = copyIntoRenderAssets(srcA, outputPathVpA, 'video');
      const destB = copyIntoRenderAssets(srcB, outputPathVpB, 'video');
      cleanup.push(destA.absPath, destB.absPath);

      expect(destA.relPath).not.toBe(destB.relPath);
      expect(fs.readFileSync(destA.absPath, 'utf8')).toBe('fake-video-a');
      expect(fs.readFileSync(destB.absPath, 'utf8')).toBe('fake-video-b');
    } finally {
      for (const p of cleanup) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  });
});
