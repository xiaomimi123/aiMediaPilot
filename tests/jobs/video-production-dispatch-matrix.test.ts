import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { REMOTION_READY_MODES, isRemotionReadyMode } from '@/lib/video-production/renderer';

/*
 * 三十期 Task 3: 旧渲染层(handlePptNarration/handleTalkingHeadBroll/
 * handleIllustrationTts 三条旧 handler)整体删除后, 选路矩阵从"6 格"收窄成
 * "3 格 + 一条 legacy 拒绝规则"——不再有 renderer=legacy 时落回旧 handler 这条路,
 * 任何非 'remotion' 的 renderer 都在选路最前面被直接拒绝, 不进入 mode 分流。
 *
 * 为什么继续用源码级(字符串/正则锚点)断言, 不真跑一遍 handleProduce: 理由与
 * 删除前一致(见 git 历史), handleProduce 本身没有导出, 牵扯 BullMQ Job 类型等
 * 大量与"选哪个 handler"无关的逻辑。
 *
 * 3 格对应关系(与 handleProduce dispatch 段的实际代码一一对应):
 *   renderer=remotion × mode=ppt-narration      → handlePptNarrationRemotion
 *   renderer=remotion × mode=illustration-tts   → handleIllustrationTtsRemotion
 *   renderer=remotion × mode=talking-head-broll → handleTalkingHeadBrollRemotion
 *   renderer≠remotion(含历史 legacy 值/任何非法值) × 任意 mode → 直接抛错,
 *   不再派发到任何 handler。
 */

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts'),
  'utf-8',
);

const DISPATCH_START = SRC.indexOf('async function handleProduce');
const DISPATCH_END = SRC.indexOf('export function startVideoProductionWorker');
if (DISPATCH_START < 0 || DISPATCH_END < 0 || DISPATCH_END <= DISPATCH_START) {
  throw new Error('测试锚点失效: 找不到 handleProduce 或 startVideoProductionWorker 的边界');
}
const DISPATCH = SRC.slice(DISPATCH_START, DISPATCH_END);

// legacy 拒绝规则——必须在 mode 分流之前, 覆盖任何非 'remotion' 的 renderer 值。
const LEGACY_REJECT_START = DISPATCH.indexOf("if (vp.renderer !== 'remotion')");
if (LEGACY_REJECT_START < 0) {
  throw new Error('测试锚点失效: 找不到 legacy 拒绝规则');
}

// mode 分流——从 isRemotionReadyMode 校验开始到函数体结束(catch 之前)。
const MODE_GATE_START = DISPATCH.indexOf('if (!isRemotionReadyMode(vp.mode))', LEGACY_REJECT_START);
const MODE_GATE_END = DISPATCH.indexOf('} catch (err) {');
if (MODE_GATE_START < 0 || MODE_GATE_END < 0 || MODE_GATE_END <= MODE_GATE_START) {
  throw new Error('测试锚点失效: 找不到 mode 分流的边界');
}
const MODE_GATE = DISPATCH.slice(MODE_GATE_START, MODE_GATE_END);

describe('选路矩阵: renderer!==remotion 直接拒绝, 不再有旧链可派发', () => {
  it('legacy 拒绝规则排在三条渲染分支之前(recompose 除外——它不走渲染路, 有意放行, 见 worker 注释)', () => {
    expect(LEGACY_REJECT_START).toBeLessThan(MODE_GATE_START);
    expect(DISPATCH.slice(LEGACY_REJECT_START, MODE_GATE_START)).toMatch(
      /throw new Error\('旧渲染已下线，请把这条任务的 renderer 切换到 remotion 后重试'\);/,
    );
  });

  it('未知 mode(不在 REMOTION_READY_MODES 里)显式抛错, 不静默派发', () => {
    expect(MODE_GATE).toMatch(
      /if \(!isRemotionReadyMode\(vp\.mode\)\) \{\s*throw new Error\(`暂不支持的交付模式/,
    );
  });

  it('mode=ppt-narration → handlePptNarrationRemotion', () => {
    expect(isRemotionReadyMode('ppt-narration')).toBe(true);
    expect(MODE_GATE).toMatch(
      /if \(vp\.mode === 'ppt-narration'\) \{\s*await handlePptNarrationRemotion\(/,
    );
  });

  it('mode=illustration-tts → handleIllustrationTtsRemotion', () => {
    // 这一断言就是变异靶子: 把 illustration-tts 从 REMOTION_READY_MODES 里
    // 去掉, 这里直接变红——不用真的跑一遍 handleProduce 也能验证清单被改坏。
    expect(isRemotionReadyMode('illustration-tts')).toBe(true);
    expect(MODE_GATE).toMatch(
      /\} else if \(vp\.mode === 'illustration-tts'\) \{\s*await handleIllustrationTtsRemotion\(/,
    );
  });

  it('mode=talking-head-broll → handleTalkingHeadBrollRemotion', () => {
    // 这一断言同样是变异靶子: 把 talking-head-broll 从 REMOTION_READY_MODES 里
    // 去掉, 这里直接变红。
    expect(isRemotionReadyMode('talking-head-broll')).toBe(true);
    expect(MODE_GATE).toMatch(
      /\} else \{\s*await handleTalkingHeadBrollRemotion\(/,
    );
  });

  it('源码里不再出现不带 Remotion 后缀的旧 handler 调用', () => {
    // \b 本身就不会在 "handlePptNarrationRemotion" 内部匹配出 "handlePptNarration"
    // (二者之间没有单词边界), 不需要额外的否定前瞻。
    expect(MODE_GATE).not.toMatch(/\bhandlePptNarration\b/);
    expect(MODE_GATE).not.toMatch(/\bhandleIllustrationTts\b/);
    expect(MODE_GATE).not.toMatch(/\bhandleTalkingHeadBroll\b/);
  });
});

describe('REMOTION_READY_MODES 清单本身', () => {
  it('三个交付模式都在清单里', () => {
    expect([...REMOTION_READY_MODES].sort()).toEqual([
      'illustration-tts', 'ppt-narration', 'talking-head-broll',
    ]);
  });

  it('worker dispatch 与 PATCH /[id] 路由共用同一份清单(源码级断言, 防两处各写一份分叉)', () => {
    expect(SRC).toContain("from '@/lib/video-production/renderer'");
    expect(SRC).toMatch(/isRemotionReadyMode/);

    const routeSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/v1/cockpit/video-productions/[id]/route.ts',
      ),
      'utf-8',
    );
    expect(routeSrc).toContain("from '@/lib/video-production/renderer'");
    expect(routeSrc).toMatch(/isRemotionReadyMode\(vp\.mode\)/);
  });
});
