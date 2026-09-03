import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * Task 3(二十九期): worker 把 TTS/真实时间窗/字幕/BGM 接进 handlePptNarrationRemotion。
 *
 * 源码级、锚结构不锚关键词——这个项目抓过好几条"关键词碰巧命中"的弱断言,
 * 所以这里的正则锚的是语法形状(if/else 分支、赋值目标、调用参数位置),
 * 不是随便某处出现了某个函数名就算过。
 */

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts'),
  'utf-8',
);

const REMOTION_START = SRC.indexOf('async function handlePptNarrationRemotion');
const REMOTION_END = SRC.indexOf('export async function reportFreeze');
if (REMOTION_START < 0 || REMOTION_END < 0 || REMOTION_END <= REMOTION_START) {
  throw new Error('测试锚点失效: 找不到 handlePptNarrationRemotion 或 reportFreeze 的边界');
}
const BRANCH = SRC.slice(REMOTION_START, REMOTION_END);

// preview 分支里"有 TTS 配置"那一段——从 if (ttsConfig) 到紧接着的 } else { 之前。
const HAS_CONFIG_START = BRANCH.indexOf('if (ttsConfig)');
const HAS_CONFIG_END = BRANCH.indexOf('} else {', HAS_CONFIG_START);
if (HAS_CONFIG_START < 0 || HAS_CONFIG_END < 0) {
  throw new Error('测试锚点失效: 找不到 if (ttsConfig) 分支边界');
}
const HAS_CONFIG_BRANCH = BRANCH.slice(HAS_CONFIG_START, HAS_CONFIG_END);
const NO_CONFIG_BRANCH = BRANCH.slice(HAS_CONFIG_END, BRANCH.length);

// master 分支——mode !== 'preview' 那一侧, 从预览分支结束(顶层 if/else 的 } else {)开始。
const TOP_ELSE = BRANCH.indexOf("} else {\n    await setStatus('building');");
if (TOP_ELSE < 0) {
  throw new Error('测试锚点失效: 找不到顶层 mode 分支的 master 一侧');
}
const MASTER_BRANCH = BRANCH.slice(TOP_ELSE);

describe('handlePptNarrationRemotion 接 TTS/真实时间窗/字幕/BGM', () => {
  it('有配置时逐幕调用 synthesizeVolcTts', () => {
    expect(HAS_CONFIG_BRANCH).toMatch(/synthesizeVolcTts\(/);
  });

  it('有配置时真实时间窗与字幕都走 aligned 版本', () => {
    expect(BRANCH).toMatch(/actWindowsFromAligned\(/);
    expect(BRANCH).toMatch(/sentenceCaptionEvents\(/);
  });

  it('无配置必须 warn 出「未配置火山 TTS」, 不能悄悄无声', () => {
    expect(BRANCH).toMatch(/未配置火山 TTS/);
  });

  it('无配置分支落到估算窗口 actWindows, 且字幕仍然产(不是跳过)', () => {
    expect(NO_CONFIG_BRANCH).toMatch(/actWindows\(acts\)/);
    // 无配置分支自己不能再调用 sentenceCaptionEvents 或 actWindowsFromAligned——
    // 字幕在 if/else 汇合之后统一调用一次, 不是两个分支各调一次。
    expect(NO_CONFIG_BRANCH).not.toMatch(/actWindowsFromAligned\(/);
  });

  it('有配置分支不吞 TTS 失败——不允许把 synthesizeVolcTts 调用包进 try/catch', () => {
    expect(HAS_CONFIG_BRANCH).not.toMatch(/catch/);
  });

  it('BGM 由 template.bgmPath 驱动, 音量取 template.bgmVolume 兜底 0.15', () => {
    expect(BRANCH).toMatch(/template\?\.bgmPath\s*\?\s*\{\s*path:\s*template\.bgmPath,\s*volume:\s*template\.bgmVolume\s*\?\?\s*0\.15\s*\}\s*:\s*null/);
  });

  it('master 分支不重新调 TTS(不出现 synthesizeVolcTts)', () => {
    expect(MASTER_BRANCH).not.toMatch(/synthesizeVolcTts\(/);
  });

  it('master 分支按 tts-audio.wav 是否存在决定是否传 audioFile(不是无条件传)', () => {
    expect(MASTER_BRANCH).toMatch(/fs\.access\(/);
    expect(MASTER_BRANCH).toMatch(/audioFile\s*=\s*null/);
  });

  it('master 分支复用持久化的 alignedActs 产字幕, 没有就抛错', () => {
    expect(MASTER_BRANCH).toMatch(/if \(!vp\.alignedActs\) throw/);
  });

  it('渲染仍然接 renderFilm, 传 audioFile/bgmFile/captions', () => {
    expect(BRANCH).toMatch(/renderFilm\(\{/);
    expect(BRANCH).toMatch(/audioFile,/);
    expect(BRANCH).toMatch(/bgmFile:/);
    expect(BRANCH).toMatch(/captions,/);
  });

  it('静止体检仍然接着', () => {
    expect(BRANCH).toContain('reportFreeze');
  });
});

describe('旧的三条分支没被顺手改动', () => {
  const oldBranches: Array<[string, string, string]> = [
    ['handlePptNarration', 'export async function handlePptNarration', 'async function handlePptNarrationRemotion'],
    // 标记里的 `(\n` 是必须的: 二十九期 Task 4 加了 `handleTalkingHeadBrollRemotion`,
    // 它的函数名以 `handleTalkingHeadBroll` 为前缀——不带 `(\n` 的话 `SRC.indexOf`
    // 会先命中前面那个新函数(它自己就调用 actWindowsFromAligned), 把这条"旧链没被
    // 顺手改动"的断言测到错的函数体上。
    ['handleTalkingHeadBroll', 'export async function handleTalkingHeadBroll(\n', 'export async function handleIllustrationTts'],
    // 同上一条注释: `handleIllustrationTtsRemotion` 也是 `handleIllustrationTts` 的
    // 前缀撞名, 且它在源码里排在旧 `handleIllustrationTts` 之前——不带 `(\n` 的话
    // `SRC.indexOf` 会先命中 Remotion 版本(它确实调用 actWindowsFromAligned)。
    ['handleIllustrationTts', 'export async function handleIllustrationTts(\n', 'async function handleProduce'],
  ];

  for (const [name, startMarker, endMarker] of oldBranches) {
    it(`${name} 函数体不含 actWindowsFromAligned`, () => {
      const start = SRC.indexOf(startMarker);
      const end = SRC.indexOf(endMarker, start);
      expect(start, `找不到 ${startMarker}`).toBeGreaterThanOrEqual(0);
      expect(end, `找不到 ${endMarker}`).toBeGreaterThan(start);
      const slice = SRC.slice(start, end);
      expect(slice).not.toMatch(/actWindowsFromAligned\(/);
    });
  }
});

describe('先建后拆: 旧渲染层一个文件都没删', () => {
  for (const f of [
    'src/lib/video-production/shot-renderer.ts',
    'src/lib/video-production/ambient-rig.ts',
    'src/lib/video-production/shot-chrome.ts',
    'src/lib/video-production/frame-overlap.ts',
  ]) {
    it(`${f} 还在`, () => {
      expect(fs.existsSync(path.join(process.cwd(), f))).toBe(true);
    });
  }
});

/*
 * timing.json 生存期不变量(二十九期 Task 5 复审): **timing.json 不得比它对应的
 * tts-audio.wav 活得久**。TTS 判定需要重新合成时必须先删旧 timing —— 否则
 * "换音色 + 对齐恰好失败"的组合会让 master 拿新音频配旧时间戳(文本层完全一致,
 * 骗过 buildWordsForEvents 的全部检查), 与 bundle public 快照同构的静默错配。
 */
describe('timing.json 生存期不得长于 tts-audio.wav', () => {
  it('TTS 重新合成分支先删旧 timing.json', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts'),
      'utf-8',
    );
    // 锚结构: 重合成分支(!canReuse)体内, synthesizeVolcTts 之前有对 timing.json 的 rm
    const branch = src.slice(src.indexOf('if (!canReuse || !existingManifest) {'));
    const rmPos = branch.indexOf("fs.rm(path.join(vp.productionRoot, 'timing.json')");
    const ttsPos = branch.indexOf('synthesizeVolcTts');
    expect(rmPos).toBeGreaterThan(-1);
    expect(ttsPos).toBeGreaterThan(-1);
    expect(rmPos).toBeLessThan(ttsPos);
  });
});
