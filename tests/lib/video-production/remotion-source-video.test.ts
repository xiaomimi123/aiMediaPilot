import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderFilm, copyIntoRenderAssets, getBundle } from '@/lib/video-production/remotion-render';
import { extractSingleFrame } from '@/lib/video/ffmpeg';
import { THEMES } from '../../../remotion/src/theme';
import { parsePpm, readPixel, hexToRgb, manhattan, meanVolumeDb, regionContainsColor } from './_ppm-test-utils';

/*
 * 二十九期 Task 3: 出镜视频层——真人出镜视频铺底, 卡片按分镜时间窗覆盖
 * (挖空替换的原生实现), cutaway 与 pip 两种版式。
 *
 * **cutaway/pip 与"bundle 输出目录同步"回归测试放回同一个文件**——复审
 * 2026-09-03 追查出的坑不是最初以为的"新文件 404"那么轻: `@remotion/bundler`
 * 的 `bundle()` 只在被调用那一刻把 `remotion/public/` 拷一次快照进 webpack
 * 输出目录, 之后不再同步; 而 `renderMedia`/`selectComposition` 的静态服务器
 * 实时读盘读的正是**那份快照**, 不是源码 `remotion/public/`。之前把
 * `copyIntoRenderAssets` 的写入目标从"源码 public 目录"改成了
 * "`getBundle()` 输出目录下的 `public/render-assets/`"——写哪读哪现在是
 * 同一处, 404 与更严重的"读到陈旧内容"错配一起解决(细节见
 * `remotion-render.ts` 的 `renderAssetsDirFor` 注释)。这份修复必须靠
 * **同一进程内连续两次成功渲染**才能验到(vitest 默认按文件隔离模块状态,
 * 拆文件会让每个文件都只经历"进程内第一次渲染", 测不出缓存效应)——上一版
 * 就是靠拆文件绕开了问题, 这次反过来靠合并到一个文件复现并钉住修复。
 *
 * 真渲染理由同 ambient-layer.test.ts/visual-style-theme.test.ts: "画面到底是
 * 卡片色还是视频画面"这类问题只有真的跑一遍 renderMedia 才作数。
 *
 * 测试素材: ffmpeg lavfi 现造几条短视频——testsrc 画面(色块图案, 与卡片纸白
 * 背景 #f3eeeb 肉眼可辨)配 440Hz 正弦波音轨(代理"人声"), 另配一条同样画面
 * 但音轨换成 anullsrc 静音的版本, 专门用于钉住"陈旧内容"这类静默错配。
 */

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

let sourceVideoPath: string; // 6 秒, 供 cutaway/pip 用
let toneVideoPath: string; // 2 秒, 有声, 供 bundle 同步回归测试用
let silentVideoPath: string; // 2 秒, 同样画面但音轨换成静音

beforeAll(() => {
  sourceVideoPath = path.join(os.tmpdir(), `source-video-src-${Date.now()}.mp4`);
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

  toneVideoPath = path.join(os.tmpdir(), `bundle-sync-tone-${Date.now()}.mp4`);
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    toneVideoPath,
  ]);

  silentVideoPath = path.join(os.tmpdir(), `bundle-sync-silent-${Date.now()}.mp4`);
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '2',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    silentVideoPath,
  ]);
}, 30_000);

afterAll(() => {
  for (const p of [sourceVideoPath, toneVideoPath, silentVideoPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe('出镜视频层: cutaway 版式', () => {
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

      // --- 中转清理: bundle 输出目录下的 render-assets/ 不应残留这条渲染用的中转视频文件 ---
      const bundleOutDir = await getBundle();
      const renderAssetsDir = path.join(bundleOutDir, 'public', 'render-assets');
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

describe('出镜视频层: pip 版式', () => {
  const outputPath = path.join(os.tmpdir(), `source-video-pip-out-${Date.now()}.mp4`);
  const fps = 15;

  // pipReserve 防撞测试专用: 纯绿色素材, 而不是复用顶层 testsrc 那条 6 秒
  // 素材——排查过程中发现 testsrc 自带一条黑到白的灰阶渐变条, 恰好落在
  // "字幕文字色"判定阈值内, 会把"视频画面自身的暗部像素"误判成"字幕探出来
  // 了", 让断言失真。纯绿色 `(0,255,0)` 与字幕文字色 `(38,41,48)` 曼哈顿距离
  // 高达 268, 不可能被字幕色阈值(25)误命中, 排除这类假阳性。
  const greenVideoPath = path.join(os.tmpdir(), `pip-reserve-green-${Date.now()}.mp4`);

  beforeAll(() => {
    execFileSync(FFMPEG_BIN, [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=green:size=640x360:rate=15:duration=2',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      greenVideoPath,
    ]);
  }, 15_000);

  afterAll(() => {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(greenVideoPath)) fs.unlinkSync(greenVideoPath);
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

  /*
   * 二十九期终审补测: pipReserve 防撞回归。
   *
   * 背景: `Captions.tsx` 的 `pipReserve` prop(见该文件顶部注释)只在
   * `Film.tsx` 算出"贴底 pip 小窗要挤占哪一侧、挤占多宽"后才生效——之前只有
   * 一次人工抽帧背书, 没有自动化测试钉住"删掉这段挤占逻辑, 字幕会撞进小窗"
   * 这条回归。
   *
   * 断言设计(区域扫描而不是单点采样, 理由见 `_ppm-test-utils.ts` 的
   * `regionContainsColor` 顶部注释——字体度量在不同机器上有细微差异, 采单点
   * 容易假阴性/假阳性):
   * - 构造一句足够长的字幕(28 个同字重复)+ pip 贴在 `br`(右下角)。实测抽帧
   *   验证过(排查时打印过字幕像素的实际外接框): `pipReserve` 生效时字幕文字
   *   横向范围约 x∈[158,1166], 稳稳落在 pip 矩形左边界(`rectX=1324`)以左;
   *   删掉 `pipReserve` 后字幕框退回 full-width 居中(中心右移约 300px), 28
   *   字长字幕右端会探进 `rectX` 以右的 pip 矩形区域——这条差异就是这个测试
   *   要钉住的东西。
   * - pip 素材特意用纯绿色(见下方 `greenVideoPath` 注释), 不用顶层共用的
   *   `sourceVideoPath`(testsrc 图案)——排查过程中发现 testsrc 自带一条
   *   黑到白的灰阶渐变条, 恰好落在字幕色判定阈值内, 会把"视频画面自身的暗部
   *   像素"误判成"字幕探出来了"。纯色视频从根上排除这类假阳性。
   * - 区域 A(字幕安全区, 明显在 pip 左边界以左): 应该扫到字幕色。
   * - 区域 B(pip 矩形内部, 与字幕同一条水平带, 四边各留一点内缩避开描边/
   *   抗锯齿): `pipReserve` 生效时不应该扫到字幕色; 删掉后应该扫到(用于
   *   变异验证, 见下方注释)。
   */
  it(
    'pipReserve 防撞: 长字幕 + pip(br) 真渲染, 字幕不探进小窗矩形',
    async () => {
      const compositionWidth = 1920;
      const compositionHeight = 1080;
      const pipScale = 0.3;
      const pipMargin = 20;
      const fps = 15;
      const totalSec = 2;
      const outputPath = path.join(os.tmpdir(), `pip-reserve-out-${Date.now()}.mp4`);
      const longCaption = '字'.repeat(28);

      try {
        await renderFilm({
          input: {
            shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '画中画 + 长字幕' } }],
            audioSrc: null,
            bgm: null,
            captions: [{ text: longCaption, startMs: 0, endMs: 2000 }],
            aspect: '16:9',
            visualStyle: 'card',
            sourceVideo: { src: '', layout: 'pip', pip: { position: 'br', scale: pipScale, margin: pipMargin } },
          },
          outputPath,
          durationInFrames: totalSec * fps,
          fps,
          sourceVideoFile: greenVideoPath,
        });

        expect(fs.existsSync(outputPath)).toBe(true);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-reserve-frame-'));
        try {
          const ppmPath = path.join(tmpDir, 'frame.ppm');
          await extractSingleFrame({ videoPath: outputPath, timestampSec: 1.0, outputPath: ppmPath });
          const ppm = parsePpm(fs.readFileSync(ppmPath));

          // pip 矩形边界(与上一条测试同一套公式)。
          const rectWidth = Math.round(compositionWidth * pipScale);
          const rectHeight = Math.round(rectWidth * (360 / 640));
          const rectX = compositionWidth - rectWidth - pipMargin;
          const rectY = compositionHeight - rectHeight - pipMargin;

          // 字幕文字色: `rgba(20,24,32,0.92)` 叠在卡片纸白背景 C.paper(#f3eeeb)
          // 上按 alpha 合成算出的近似值, 与卡片纸白色相距(见下方)足够远,
          // 不会跟卡片本身的颜色混淆。
          const captionTextRgb: [number, number, number] = [38, 41, 48];

          // 区域 A: 字幕安全区一段明显在 pip 左边界(rectX)以左、且落在字幕
          // 那一条水平带(顶部往下 100~1080 高度换算出的字幕行)里的窄条。
          const capRowTop = 800;
          const capRowBottom = 880;
          const regionA: { x: [number, number]; y: [number, number] } = {
            x: [220, 900],
            y: [capRowTop, capRowBottom],
          };
          expect(regionContainsColor(ppm, regionA.x, regionA.y, captionTextRgb, 25)).toBe(true);

          // 区域 B: pip 矩形内部, 四边各内缩 10px 避开描边/圆角/抗锯齿噪声。
          const regionB: { x: [number, number]; y: [number, number] } = {
            x: [rectX + 10, rectX + rectWidth - 10],
            y: [Math.max(capRowTop, rectY + 10), Math.min(capRowBottom, rectY + rectHeight - 10)],
          };
          expect(regionContainsColor(ppm, regionB.x, regionB.y, captionTextRgb, 25)).toBe(false);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    },
    120_000,
  );

  /*
   * 照例变异(任务原文要求): 把 `Film.tsx` 里 `pipReserve` 的计算临时改成
   * 恒为 `undefined`(相当于删掉这段挤占逻辑), 重跑本文件这一条测试。
   *
   * 实测: 区域 A 断言(字幕安全区应有字幕色)依然通过——`pipReserve` 被删掉后
   * 字幕框退回 full-width 居中, 区域 A 仍然落在文字范围内。区域 B 断言("pip
   * 矩形内部不应有字幕色")按预期失败: 删除后字幕框居中点右移到屏幕正中,
   * 28 字长字幕有一段确实探进了 pip 矩形左侧区域, `regionContainsColor`
   * 扫到了字幕色, `toBe(false)` 断言翻红。验证完已把 `pipReserve` 计算改回来。
   */
});

describe('出镜视频层: pip circle 形状(二十九期终审补测)', () => {
  /*
   * 背景: `shape:'circle'` 分支(`Film.tsx` `resolveShape`/`isCircle` 那段,
   * 见 `FilmInput.sourceVideo.pip.shape` 顶部注释)之前只有一次人工抽帧背书。
   *
   * 断言设计: 小窗外接正方形的四角必然被圆形裁掉——正方形对角线半长
   * (`pipWidth*Math.SQRT2/2 ≈ 0.707*pipWidth`)总是大于圆半径(`0.5*pipWidth`),
   * 这是纯几何事实, 不依赖具体尺寸取值, 所以四角随便内缩几像素采样就足够
   * 稳(内缩量远小于"对角线半长-半径"这条余量, 约 0.207*pipWidth)。四角应该
   * 露出圆外的背景色, 中心应该是圆内的视频画面。
   *
   * 角点不直接比对写死的 `paperRgb`, 而是跟同一对角线方向再往外挪一截、落在
   * 小窗矩形之外的邻近像素比——排查时发现 `Ambient` 的呼吸 vignette 会让画面
   * 四角本来就偏暗, pip 又贴在 `br`(画面右下角), 直接比死数字会把 vignette
   * 的暗角一起算成"差异", 误判成"没裁掉"。跟紧邻的真实背景像素比,
   * vignette/阴影在这个尺度上几乎不变, 能把两点共同的背景修饰抵消掉, 只留下
   * "这一点到底是背景还是视频"这个真正要判断的差异。
   *
   * `rounded`(圆角矩形)分支同一份代码路径里已经在其它测试里跑到过(所有
   * pip 测试默认走 rounded), 只是没有专门为"圆角把四角切没切"单独断言过——
   * 这里按任务原文说明理由, 只测 `circle`: `rounded` 的圆角半径只是小窗宽度
   * 的 10%(`PIP_BORDER_RADIUS_RATIO`), 四角被裁掉的像素范围窄到几乎无法在
   * 1920x1080 抽帧里选出"确定落在裁切三角形内、又不会被抗锯齿/描边噪声
   * 污染"的采样点——`circle` 是这处新逻辑里最容易坏、也最好测的分支(裁切范围
   * 大、跟"未生效"的差异是有没有裁切, 不是裁多少), 优先测它。
   */
  it(
    '四角像素 = 背景色(被圆裁掉), 中心 ≠ 背景色(视频仍铺在圆内)',
    async () => {
      const compositionWidth = 1920;
      const compositionHeight = 1080;
      const pipScale = 0.3;
      const pipMargin = 20;
      const fps = 15;
      const outputPath = path.join(os.tmpdir(), `pip-circle-out-${Date.now()}.mp4`);

      try {
        await renderFilm({
          input: {
            shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '圆形画中画' } }],
            audioSrc: null,
            bgm: null,
            captions: [],
            aspect: '16:9',
            visualStyle: 'card',
            sourceVideo: {
              src: '',
              layout: 'pip',
              pip: { position: 'br', scale: pipScale, margin: pipMargin, shape: 'circle' },
            },
          },
          outputPath,
          durationInFrames: 2 * fps,
          fps,
          sourceVideoFile: sourceVideoPath,
        });

        expect(fs.existsSync(outputPath)).toBe(true);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-circle-frame-'));
        try {
          const ppmPath = path.join(tmpDir, 'frame.ppm');
          await extractSingleFrame({ videoPath: outputPath, timestampSec: 1.0, outputPath: ppmPath });
          const ppm = parsePpm(fs.readFileSync(ppmPath));

          // circle: 宽高相等(正方形), 边长与 rounded 的宽度公式相同。
          const pipWidth = Math.round(compositionWidth * pipScale);
          const rectX = compositionWidth - pipWidth - pipMargin;
          const rectY = compositionHeight - pipWidth - pipMargin;

          const paperRgb = hexToRgb(THEMES.card.background);
          const inset = 8; // 远小于 0.207*pipWidth(≈119px)的裁切余量
          // 参照点与角点同一对角线方向再往外挪一截, 落在小窗矩形之外的纯背景上
          // (排查时发现: `Ambient` 的呼吸 vignette 在画面四角本来就会压暗底色,
          // pip 贴在 `br` 靠近画面右下角, 直接拿死数字 `paperRgb` 去比角点会被
          // vignette 的暗角一起算进"差异"里, 误判成"没裁掉"。改成跟紧邻的真实
          // 背景像素比, 两点相距够近、vignette 在这个尺度上几乎不变, shadow 的
          // 24px 模糊半径也同时盖住两点, 能把这两处共同的背景修饰"减掉", 只留下
          // "这一点到底是背景还是视频"这个真正要判断的差异)。
          const refOffset = 15;

          const corners: { point: [number, number]; ref: [number, number] }[] = [
            { point: [rectX + inset, rectY + inset], ref: [rectX - refOffset, rectY - refOffset] }, // 左上
            {
              point: [rectX + pipWidth - 1 - inset, rectY + inset],
              ref: [rectX + pipWidth - 1 + refOffset, rectY - refOffset],
            }, // 右上
            {
              point: [rectX + inset, rectY + pipWidth - 1 - inset],
              ref: [rectX - refOffset, rectY + pipWidth - 1 + refOffset],
            }, // 左下
            {
              point: [rectX + pipWidth - 1 - inset, rectY + pipWidth - 1 - inset],
              ref: [rectX + pipWidth - 1 + refOffset, rectY + pipWidth - 1 + refOffset],
            }, // 右下
          ];
          for (const { point, ref } of corners) {
            const pixel = readPixel(ppm, point[0], point[1]);
            const refPixel = readPixel(ppm, ref[0], ref[1]);
            expect(manhattan(pixel, refPixel)).toBeLessThan(20);
          }

          const centerX = rectX + Math.floor(pipWidth / 2);
          const centerY = rectY + Math.floor(pipWidth / 2);
          const centerPixel = readPixel(ppm, centerX, centerY);
          expect(manhattan(centerPixel, paperRgb)).toBeGreaterThan(10);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    },
    120_000,
  );

  /*
   * 照例变异(任务原文要求): 把 `Film.tsx` 里 `isCircle` 分支的
   * `borderRadius: isCircle ? '50%' : ...` 临时改成恒用 rounded 那条公式
   * (相当于删掉 circle 的裁切逻辑), 重跑本条测试。
   *
   * 实测: 四角断言按预期翻红——不再是圆形裁切, 四角这时候要么是圆角矩形的
   * 直角区域(仍是视频画面), 与背景纸白色的曼哈顿距离远大于 10, `toBeLessThan
   * (10)` 断言失败。中心断言不受影响(圆角矩形中心本来就还是视频画面)。
   * 验证完已把 `isCircle` 分支改回来。
   */
});

describe('renderFilm: bundle 输出目录同步(复审 2026-09-03 修复验证)', () => {
  /*
   * 这两条测试把复审追查出的实验结果固化下来:
   *
   * 1. 同进程两次 renderFilm、派生出**不同**中转文件名 → 第二次渲染在修复前
   *    会 404(静态服务器读的是 bundle() 那一刻的快照, 看不到后来新拷贝的
   *    文件), 修复后应当成功。
   * 2. 同进程两次 renderFilm、派生出**相同**中转文件名, 第二次把源内容换成
   *    静音 → 修复前静态服务器仍然读到第一次快照里的陈旧内容(有声,
   *    ~-24dB), 不报任何错; 修复后应该读到第二次真正写入的静音内容
   *    (~-91dB)。**这条是钉住"静默错配"的核心测试**——比 404 更危险,
   *    因为它不会让任何调用方知道自己拿到的是错的成片。
   *
   * 两条必须放在同一个测试文件里连续跑: vitest 默认按文件隔离模块状态
   * (每个文件是独立的 worker/模块注册表), `bundlePromise` 这个进程内缓存
   * 只有在同一个文件里才会被两次 renderFilm 调用共享, 拆开测试会让每个文件
   * 都只经历"进程内第一次渲染"这个天然安全的位置, 测不出缓存效应。
   */

  const dirA = path.join(os.tmpdir(), `bundle-sync-vp-a-${Date.now()}`);
  const dirB = path.join(os.tmpdir(), `bundle-sync-vp-b-${Date.now()}`);
  const outputPathA = path.join(dirA, 'master.mp4');
  const outputPathB = path.join(dirB, 'master.mp4');
  const fps = 15;

  afterAll(() => {
    for (const p of [outputPathA, outputPathB]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    for (const d of [dirA, dirB]) {
      if (fs.existsSync(d)) fs.rmdirSync(d);
    }
  });

  const baseInput = {
    shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement' as const, slots: { text: 'bundle 同步回归' } }],
    audioSrc: null,
    bgm: null,
    captions: [],
    aspect: '16:9' as const,
    visualStyle: 'card' as const,
  };

  it(
    '同进程两次渲染、不同派生文件名 → 第二次也应成功(修复前 404)',
    async () => {
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      // 第一次: vp-a 目录, 触发进程内第一次 getBundle()/bundle()。
      await renderFilm({
        input: { ...baseInput, sourceVideo: { src: '', layout: 'cutaway', pip: null } },
        outputPath: outputPathA,
        durationInFrames: 2 * fps,
        fps,
        sourceVideoFile: toneVideoPath,
      });
      expect(fs.existsSync(outputPathA)).toBe(true);

      // 第二次: vp-b 目录——父目录名不同, 派生出的中转文件名(`vp-b...-video.mp4`)
      // 与第一次(`vp-a...-video.mp4`)不同, 修复前这里会因为"新文件不在 bundle
      // 快照里"而 404。
      await renderFilm({
        input: { ...baseInput, sourceVideo: { src: '', layout: 'cutaway', pip: null } },
        outputPath: outputPathB,
        durationInFrames: 2 * fps,
        fps,
        sourceVideoFile: toneVideoPath,
      });
      expect(fs.existsSync(outputPathB)).toBe(true);
    },
    120_000,
  );

  it(
    '同进程两次渲染、相同派生文件名, 第二次内容换静音 → 成片应是静音(修复前读到第一次的陈旧有声内容)',
    async () => {
      fs.mkdirSync(dirA, { recursive: true });

      // 第一次: 有声素材, 写进 outputPathA(dirA/master.mp4)。
      await renderFilm({
        input: { ...baseInput, sourceVideo: { src: '', layout: 'cutaway', pip: null } },
        outputPath: outputPathA,
        durationInFrames: 2 * fps,
        fps,
        sourceVideoFile: toneVideoPath,
      });
      const firstDb = meanVolumeDb(outputPathA);
      // 确认第一次确实是有声的(约 -24dB 量级, 与 spike/cutaway 测试同一素材一致)。
      expect(firstDb).toBeGreaterThan(-60);

      // 第二次: 同一个 outputPath(dirA/master.mp4)——派生文件名逐字节相同
      // (dirName='...vp-a...', baseName='master', kind='video'), 但这次源
      // 素材换成静音版。修复前: 静态服务器仍然读到第一次 bundle 快照里那份
      // 陈旧的有声内容, `secondDb` 会跟 `firstDb` 几乎一样(~-24dB), 且没有
      // 任何报错——这就是"静默错配"。修复后: 应该读到这次真正写入的静音内容。
      await renderFilm({
        input: { ...baseInput, sourceVideo: { src: '', layout: 'cutaway', pip: null } },
        outputPath: outputPathA,
        durationInFrames: 2 * fps,
        fps,
        sourceVideoFile: silentVideoPath,
      });
      const secondDb = meanVolumeDb(outputPathA);

      // 核心断言: 第二次成片应该是数字静音(spike: muted 时 -91dB 量级),
      // 明显低于第一次的 ~-24dB, 而不是"看起来和第一次一样"。
      expect(secondDb).toBeLessThan(-60);
      expect(firstDb - secondDb).toBeGreaterThan(20);
    },
    120_000,
  );
});

describe('copyIntoRenderAssets: 出镜视频中转清理(照音频先例)', () => {
  it('sourceVideoFile 指向不存在的路径 → 抛错, 且 render-assets/ 无残留文件', async () => {
    const bundleOutDir = await getBundle();
    const renderAssetsDir = path.join(bundleOutDir, 'public', 'render-assets');
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

  it("两个不同父目录、同名 basename → 派生出不同的中转文件名('video' kind)", async () => {
    const bundleOutDir = await getBundle();
    const renderAssetsDir = path.join(bundleOutDir, 'public', 'render-assets');
    const cleanup: string[] = [];
    try {
      const srcA = path.join(os.tmpdir(), `render-assets-video-naming-a-${Date.now()}.mp4`);
      const srcB = path.join(os.tmpdir(), `render-assets-video-naming-b-${Date.now()}.mp4`);
      fs.writeFileSync(srcA, 'fake-video-a');
      fs.writeFileSync(srcB, 'fake-video-b');
      cleanup.push(srcA, srcB);

      const outputPathVpA = path.join(os.tmpdir(), 'vp-video-aaaa', 'master.mp4');
      const outputPathVpB = path.join(os.tmpdir(), 'vp-video-bbbb', 'master.mp4');

      const destA = copyIntoRenderAssets(srcA, outputPathVpA, 'video', renderAssetsDir);
      const destB = copyIntoRenderAssets(srcB, outputPathVpB, 'video', renderAssetsDir);
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
