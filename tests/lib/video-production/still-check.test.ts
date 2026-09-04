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

describe('renderShotStill + judgeStillPng: 低密度卡片会被报出', () => {
  it(
    '一个字的 statement 卡 —— 判据应报"太空"或"内容过于集中"',
    async () => {
      const outputPath = path.join(os.tmpdir(), `still-check-low-density-${Date.now()}.png`);
      const input: FilmInput = {
        ...baseInput(),
        shots: [{ shotId: 'a', startMs: 0, endMs: 2000, card: 'statement', slots: { text: '一' } }],
      };
      const t0 = Date.now();
      await renderShotStill({ input, shotIndex: 0, atMs: 1000, outputPath });
      const elapsedMs = Date.now() - t0;
      // eslint-disable-next-line no-console -- 有意打日志: 单帧 renderStill 耗时是
      // 决定"是否需要抽样"这条判断的实测依据, 见 remotion-render.ts renderShotStill 注释。
      console.log(`[still-check.test] 单帧 renderStill 耗时 ${elapsedMs}ms`);

      try {
        expect(fs.existsSync(outputPath)).toBe(true);
        const judgement = await judgeStillPng(outputPath, FRAME_WIDTH, FRAME_HEIGHT);
        expect(judgement.ok).toBe(false);
        expect(judgement.reason).toBeTruthy();
      } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    },
    60_000,
  );

  it(
    '正常信息卡(list, 多条目铺开) —— 判据不应报',
    async () => {
      const outputPath = path.join(os.tmpdir(), `still-check-normal-${Date.now()}.png`);
      const input: FilmInput = {
        ...baseInput(),
        shots: [
          {
            shotId: 'a',
            startMs: 0,
            endMs: 2000,
            card: 'list',
            slots: {
              title: '三十期做了什么',
              items: [
                '画面体检从 DOM 探针换成 renderStill 抽帧',
                '判据函数原样搬到 still-check.ts, 只报不拦',
                '旧渲染层文件本身暂不动, 留给 Task 3 一并删除',
                '每镜中点抽一帧, 与静止体检同一策略',
              ],
            },
          },
        ],
      };
      await renderShotStill({ input, shotIndex: 0, atMs: 1000, outputPath });

      try {
        expect(fs.existsSync(outputPath)).toBe(true);
        const judgement = await judgeStillPng(outputPath, FRAME_WIDTH, FRAME_HEIGHT);
        expect(judgement.ok).toBe(true);
      } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    },
    60_000,
  );

  /*
   * 照例变异(任务原文要求): 先试着把 `MIN_CONTENT_RATIO`/`MIN_CELLS_USED` 改成
   * 0(相当于关掉密度判据), 重跑第一条测试 —— **没有翻红**。打印 judgement 一看
   * 才发现: 一个字的 statement(72px 大字号)渲出来的实际是"一大块留白里嵌一个
   * 字", `contentRatio` 42% 早已过了 `judgeFrameDensity` 的 1% 门槛(不算"空屏"),
   * 真正拦下它的是 `judgeHollowCard`(色块占 42%, 细节只有 0.1%, 比值远低于
   * `HOLLOW_MIN_RATIO`)——这张卡片报的是"大色块刷分"而不是"画面太空", 判据函数
   * 用对了, 是我最初以为的失败模式猜错了。
   *
   * 改把 `HOLLOW_MIN_RATIO` 从 0.15 临时改成 0(相当于关掉空壳判据), 重跑:
   * `judgement.ok` 变成 `true`, `expect(judgement.ok).toBe(false)` 如期翻红——
   * 证明这条测试确实钉住了 `judgeHollowCard` 这条判据, 不是恒真断言。验证完已把
   * `HOLLOW_MIN_RATIO` 改回 0.15。
   */
});
