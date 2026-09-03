import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { renderFilm } from '@/lib/video-production/remotion-render';
import { runFreezeDetect, judgeFreeze, DEFAULT_FREEZE_OPTS } from '@/lib/video/freeze-check';

/*
 * 二十六期: 环境运动层(remotion/src/motion/ambient.tsx + Film.tsx 里的
 * CameraRig 推近)补的是「整片静止占比」这一维——真机实测过, 补之前这条
 * 14 秒三镜样片(Task 5 用的同一条 filmPlan)静止占比 71%, 远超
 * `MAX_FREEZE_RATIO`(0.08)。
 *
 * 这里不是 mock 出来的单元测试: 真渲染一条 mp4、真跑一次 `freezedetect`,
 * 理由和 `shot-renderer.test.ts`/`shot-probe.test.ts` 一样——运动层这种
 * "画面里到底动没动"的东西, 断言 JSX 结构测不出来, 只有跑一遍成片才作数。
 * 完整的 A/B 参数选择过程见 `.superpowers/sdd/2026-08-31-remotion-foundation/
 * ambient-layer-report.md`, 这里只锁住"回归"这一条: 以后改动 CameraRig/
 * Ambient 的参数, 这条测试要能抓住"又退回大面积静止"这种倒退。
 */
describe('环境运动层: 静止占比回归', () => {
  it(
    'Task 5 的 14 秒三镜 filmPlan 渲染后, 静止占比在 MAX_FREEZE_RATIO 以内',
    async () => {
      const shots = [
        { shotId: 'a', startMs: 0, endMs: 4000, card: 'statement', slots: { text: '三天用AI赚5000？', sub: '刷到过吗' } },
        { shotId: 'b', startMs: 4000, endMs: 9000, card: 'stat', slots: { label: '月均成交额', value: 900, prefix: '不足 ', suffix: ' 元' } },
        { shotId: 'c', startMs: 9000, endMs: 14000, card: 'contrast', slots: { leftLabel: '技术', leftText: '人人可得', rightLabel: '提问', rightText: '拉开差距' } },
      ];
      const fps = 15; // 与 Task 5 端到端验收一致的预览帧率
      const durationInFrames = Math.ceil((4000 + 5000 + 5000) / 1000 * fps);
      const outputPath = path.join(os.tmpdir(), `ambient-layer-test-${Date.now()}.mp4`);

      try {
        await renderFilm({
          input: { shots: shots as any, audioSrc: null, bgm: null, captions: [], aspect: '16:9', visualStyle: 'card' },
          outputPath,
          durationInFrames,
          fps,
        });

        const segments = await runFreezeDetect(outputPath, DEFAULT_FREEZE_OPTS, undefined, 14.06);
        const judgement = judgeFreeze(segments, 14.06);

        expect(judgement.ok, judgement.reason).toBe(true);
      } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    },
    120_000,
  );
});
