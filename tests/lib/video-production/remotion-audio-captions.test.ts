import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderFilm, copyIntoRenderAssets, getBundle } from '@/lib/video-production/remotion-render';
import { pickCurrentCaption } from '../../../remotion/src/caption-logic';

/*
 * 二十八期: Remotion 合成接人声/BGM/字幕层。
 *
 * 四块各选最省成本又管用的验证方式:
 *   1. 中转与清理——不真渲染, 只验证 renderFilm 的文件搬运/清理副作用
 *      (拷贝失败要抛错、render-assets/ 不能有残留)。
 *   2. 真渲染一条极短样片 + 1 秒正弦波 wav, ffprobe 断言成片里真的有音频流。
 *      这条不能用 mock——"最终 mp4 有没有音轨"这件事只有真的跑一遍
 *      renderMedia + ffmpeg mux 才作数, 参照 `ambient-layer.test.ts` 的先例
 *      (真实渲染, 120s 超时, 渲后删产物)。
 *   3. 字幕当前句选择逻辑——选择"抽出纯函数单测", 不选 renderStill 抽帧断言
 *      画面文字。理由: Captions 组件本身只是把 pickCurrentCaption 的结果
 *      套进一个纯样式 div, 没有任何值得用视觉手段验证的画面逻辑(不像
 *      freeze-check 那种"画面到底动没动"必须真渲染才能回答的问题); 而
 *      renderStill 抽帧断言文字要么去读像素(脆弱, 字体渲染在不同机器可能
 *      有细微差异), 要么去读 DOM(renderStill 产出的是位图, 读不到 DOM)。
 *      纯函数单测能精确覆盖区间边界(左闭右开、句间空隙、多句重叠这些真正
 *      容易出 bug 的地方), 又是毫秒级的, 不需要另起一次渲染。
 *   4. 中转文件名的防并发派生——复审 2026-09-03 发现: worker 侧
 *      `outputFileName` 是常量 `'preview.mp4'`/`'master.mp4'`, vp id 只在
 *      `outputPath` 的父目录名里, 单用 `basename(outputPath)` 派生文件名
 *      不防并发。改成父目录名(vp id)+basename 共同派生后, 用这条单测直接
 *      锁住"两个不同父目录、同名 basename → 不同中转文件名", 不用真的跑
 *      两个并发渲染去复现撞车。
 */

describe('renderFilm: 音频文件中转与清理', () => {
  it('audioFile 指向不存在的路径 → 抛错, 且 render-assets/ 无残留文件', async () => {
    // renderAssetsDir 现在是 bundle 输出目录下的 public/render-assets(见
    // remotion-render.ts 的 renderAssetsDirFor 注释), 不是源码 remotion/public/——
    // getBundle() 按进程缓存, 这里调用不会重新触发一次真实 bundle。
    const bundleOutDir = await getBundle();
    const renderAssetsDir = path.join(bundleOutDir, 'public', 'render-assets');
    const missingAudio = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.wav`);
    const outputPath = path.join(os.tmpdir(), `remotion-audio-test-missing-${Date.now()}.mp4`);
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
          sourceVideo: null,
        },
        outputPath,
        durationInFrames: 15,
        fps: 15,
        audioFile: missingAudio,
      }),
    ).rejects.toThrow();

    const after = fs.existsSync(renderAssetsDir) ? fs.readdirSync(renderAssetsDir) : [];
    // 拷贝在写入目标文件之前就该失败——不应该多出任何文件。
    expect(after).toEqual(before);
    expect(fs.existsSync(outputPath)).toBe(false);
  });
});

describe('renderFilm: 真渲染一条带人声的样片', () => {
  const tmpWav = path.join(os.tmpdir(), `remotion-audio-test-tone-${Date.now()}.wav`);
  const outputPath = path.join(os.tmpdir(), `remotion-audio-test-output-${Date.now()}.mp4`);

  afterEach(() => {
    if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  it(
    '2 秒 statement 卡 + 1 秒正弦波 wav → 成片带音频流, 中转文件渲后已清理',
    async () => {
      execFileSync('ffmpeg', [
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-y', tmpWav,
      ]);

      const fps = 15;
      const durationInFrames = Math.ceil((2000 / 1000) * fps);

      await renderFilm({
        input: {
          shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '带人声的一镜' } }],
          audioSrc: null,
          bgm: null,
          captions: [{ text: '带人声的一镜', startMs: 0, endMs: 2000 }],
          aspect: '16:9',
          visualStyle: 'card',
          sourceVideo: null,
        },
        outputPath,
        durationInFrames,
        fps,
        audioFile: tmpWav,
      });

      expect(fs.existsSync(outputPath)).toBe(true);

      // ffprobe 断言成片里确实有音频流(不是只看文件大小/时长这种间接信号)。
      const probeOut = execFileSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        outputPath,
      ]).toString().trim();
      expect(probeOut).toBe('audio');

      // 中转文件应该已经在 renderFilm 的 finally 里被删掉。renderAssetsDir 是
      // bundle 输出目录下的 public/render-assets(与上面拷贝目标同一处)。
      const bundleOutDir = await getBundle();
      const renderAssetsDir = path.join(bundleOutDir, 'public', 'render-assets');
      const remaining = fs.existsSync(renderAssetsDir) ? fs.readdirSync(renderAssetsDir) : [];
      const leaked = remaining.filter((f) => f.includes(path.basename(outputPath, '.mp4')));
      expect(leaked).toEqual([]);
    },
    120_000,
  );
});

describe('pickCurrentCaption: 当前句选择的纯逻辑', () => {
  const items = [
    { text: '第一句', startMs: 0, endMs: 1000 },
    { text: '第二句', startMs: 1000, endMs: 2000 },
  ];

  it('命中区间内返回对应句', () => {
    expect(pickCurrentCaption(items, 500)?.text).toBe('第一句');
    expect(pickCurrentCaption(items, 1500)?.text).toBe('第二句');
  });

  it('左闭右开: startMs 命中当前句, endMs 命中下一句(不重叠)', () => {
    expect(pickCurrentCaption(items, 0)?.text).toBe('第一句');
    expect(pickCurrentCaption(items, 1000)?.text).toBe('第二句');
  });

  it('句间空隙 / 片头片尾之外返回 undefined', () => {
    expect(pickCurrentCaption(items, -1)).toBeUndefined();
    expect(pickCurrentCaption(items, 2000)).toBeUndefined();
    expect(pickCurrentCaption([], 500)).toBeUndefined();
  });
});

describe('copyIntoRenderAssets: 中转文件名的防并发派生', () => {
  // 这条测试只验证文件名派生规则, 不牵扯 bundle/renderMedia——随便一个临时目录
  // 就够当 renderAssetsDir 用, 不需要真的调用 getBundle()。
  const renderAssetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-assets-naming-'));
  const cleanup: string[] = [];

  afterEach(() => {
    for (const p of cleanup.splice(0)) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('两个不同父目录(不同 vp id)、同名 basename → 派生出不同的中转文件名', () => {
    // 模拟 worker 侧的真实场景: outputFileName 是常量 'master.mp4',
    // vp id 只体现在 productionRoot 下的父目录名里。
    const srcA = path.join(os.tmpdir(), `render-assets-naming-src-a-${Date.now()}.wav`);
    const srcB = path.join(os.tmpdir(), `render-assets-naming-src-b-${Date.now()}.wav`);
    fs.writeFileSync(srcA, 'fake-audio-a');
    fs.writeFileSync(srcB, 'fake-audio-b');
    cleanup.push(srcA, srcB);

    const outputPathVpA = path.join(os.tmpdir(), 'vp-aaaa', 'master.mp4');
    const outputPathVpB = path.join(os.tmpdir(), 'vp-bbbb', 'master.mp4');

    const destA = copyIntoRenderAssets(srcA, outputPathVpA, 'voice', renderAssetsDir);
    const destB = copyIntoRenderAssets(srcB, outputPathVpB, 'voice', renderAssetsDir);
    cleanup.push(destA.absPath, destB.absPath);

    // 核心断言: 同名 basename('master.mp4') 不应该撞向同一个中转文件——
    // 否则并发调大后, 一个 vp 的清理会删掉另一个 vp 正在读的文件。
    expect(destA.relPath).not.toBe(destB.relPath);
    expect(destA.absPath).not.toBe(destB.absPath);
    // 两个文件各自都要真的落地在 render-assets/ 下, 不是同一份被覆盖。
    expect(fs.existsSync(destA.absPath)).toBe(true);
    expect(fs.existsSync(destB.absPath)).toBe(true);
    expect(fs.readFileSync(destA.absPath, 'utf8')).toBe('fake-audio-a');
    expect(fs.readFileSync(destB.absPath, 'utf8')).toBe('fake-audio-b');
    expect(path.dirname(destA.absPath)).toBe(renderAssetsDir);
  });
});
