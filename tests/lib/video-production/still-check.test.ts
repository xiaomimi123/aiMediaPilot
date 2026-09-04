import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { renderShotStill, type FilmInput } from '@/lib/video-production/remotion-render';
import { judgeStillPng } from '@/lib/video-production/still-check';

/*
 * 三十期 Task 1: 画面体检从 DOM 探针换成 `renderStill` 抽帧, 判据函数原样从
 * `frame-density.ts`/`frame-detail.ts` 搬到 `still-check.ts`(见该文件顶部注释)。
 *
 * 三十一期: 三十期真机回归暴露 `judgeFrameDensity`/`judgeHollowCard` 在填槽架构下
 * 大面积误报(ppt-narration 25/26 镜、illustration 15/16 镜、出镜链 0/20 通过,
 * 人工核实全是正常卡面) —— 这两个判据是按"模型自由写 HTML 铺大色块刷分"标定的,
 * 与"版面由卡片组件保证、大量留白是设计"的填槽架构错配。判据停用(留在
 * `still-check.ts` 里不删), `judgeStillPng` 改用只认「真空屏」的 `judgeBlankStill`
 * (标定数据见该函数顶部注释)。下面测试对应改写: 四种卡各一条正常内容都不应该报,
 * 只有真的什么都没渲出来的空屏才应该报。
 *
 * 真渲染理由同 `remotion-source-video.test.ts`: "抽出来的帧到底有没有内容"这类
 * 问题只有真的跑一遍 `renderStill` 才作数, 不能靠猜像素。
 */

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;

const baseInput = (): FilmInput => ({
  shots: [],
  audioSrc: null,
  bgm: null,
  captions: [],
  aspect: '9:16',
  visualStyle: 'card',
  sourceVideo: null,
});

async function renderAndJudge(input: FilmInput, atMs: number, label: string) {
  const outputPath = path.join(os.tmpdir(), `still-check-${label}-${Date.now()}.png`);
  await renderShotStill({ input, shotIndex: 0, atMs, outputPath });
  try {
    expect(fs.existsSync(outputPath)).toBe(true);
    return await judgeStillPng(outputPath, FRAME_WIDTH, FRAME_HEIGHT);
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

describe('renderShotStill + judgeStillPng: 真空屏判据(三十一期)', () => {
  it(
    '真空屏(取帧落在 shot 时间窗之外, Sequence 未挂载) —— 判据应报"疑似空白帧"',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [{ shotId: 'a', startMs: 0, endMs: 1000, card: 'statement', slots: { text: '这一镜的时间窗在前面' } }],
      };
      // atMs=5000 远超 shot 的 endMs=1000, 卡片的 Sequence 早已卸载, 画面上只剩
      // 全局背景 + Ambient 环境运动层 —— 这是标定注释里"负样本"那条的复现。
      const judgement = await renderAndJudge(input, 5000, 'blank');
      expect(judgement.ok).toBe(false);
      expect(judgement.reason).toBeTruthy();
    },
    60_000,
  );

  it(
    '正常 statement 卡(长句, 铺开排版) —— 判据不应报',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [{ shotId: 'a', startMs: 0, endMs: 3000, card: 'statement', slots: { text: '这是一句正常的陈述文案' } }],
      };
      const judgement = await renderAndJudge(input, 1500, 'statement');
      expect(judgement.ok).toBe(true);
    },
    60_000,
  );

  it(
    '正常 stat 卡 —— 判据不应报',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [{ shotId: 'a', startMs: 0, endMs: 3000, card: 'stat', slots: { label: '播放量增长', value: 320, suffix: '%' } }],
      };
      const judgement = await renderAndJudge(input, 1500, 'stat');
      expect(judgement.ok).toBe(true);
    },
    60_000,
  );

  it(
    '正常 contrast 卡 —— 判据不应报',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [
          {
            shotId: 'a',
            startMs: 0,
            endMs: 3000,
            card: 'contrast',
            slots: { leftLabel: '以前', leftText: '手动剪辑', rightLabel: '现在', rightText: 'AI 自动生成' },
          },
        ],
      };
      const judgement = await renderAndJudge(input, 1500, 'contrast');
      expect(judgement.ok).toBe(true);
    },
    60_000,
  );

  it(
    '正常 list 卡(多条目铺开) —— 判据不应报',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [
          {
            shotId: 'a',
            startMs: 0,
            endMs: 3000,
            card: 'list',
            slots: {
              title: '三十一期做了什么',
              items: ['修体检误报', '标定新阈值', '真机复验'],
            },
          },
        ],
      };
      const judgement = await renderAndJudge(input, 1500, 'list');
      expect(judgement.ok).toBe(true);
    },
    60_000,
  );

  it(
    '极端稀疏卡面(一个字的 statement, 大留白+单字) —— 判据不应报(这是三十期真机误报的具体形态)',
    async () => {
      const input: FilmInput = {
        ...baseInput(),
        shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '一' } }],
      };
      const judgement = await renderAndJudge(input, 1000, 'sparse');
      expect(judgement.ok).toBe(true);
    },
    60_000,
  );

  /*
   * 照例变异(任务原文要求): 把 `still-check.ts` 里的 `MIN_BLANK_DETAIL_RATIO`
   * 从 0.0003 临时改成 0.005(即真机标定注释里"最低正样本的 1/3"往上调到接近
   * 最低正样本本身)——重跑"极端稀疏卡面"这条(细节占比实测 0.118%~0.124%,
   * 低于 0.5%): `judgement.ok` 变成 `false`, 上面的 `expect(judgement.ok).toBe(true)`
   * 如期翻红。证明这条测试确实钉住了 `MIN_BLANK_DETAIL_RATIO` 这个阈值, 不是
   * 恒真断言。验证完已把 `MIN_BLANK_DETAIL_RATIO` 改回 0.0003。
   */
});
