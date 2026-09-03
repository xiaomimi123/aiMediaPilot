import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { REMOTION_READY_MODES, isRemotionReadyMode } from '@/lib/video-production/renderer';

/*
 * 二十九期 Task 2: 选路矩阵源码级测试 —— mode(ppt-narration / illustration-tts /
 * talking-head-broll) × renderer(legacy / remotion) 共 6 格, 逐格断言 handleProduce
 * 会走哪个 handler。
 *
 * 为什么是源码级(字符串/正则锚点), 不是真跑一遍 handleProduce: handleProduce 本身
 * 没有导出, 而且它内部还牵扯 BullMQ Job 类型、文字叠加层、成片包装段等一大堆和
 * "选哪个 handler" 无关的逻辑——要跑通整条链路需要把 LLM/TTS/ffmpeg/Chromium 全部
 * mock 一遍(worker-visual-style.test.ts 那种规模), 而这里只想钉住"分流开关本身没
 * 接错"，用源码结构断言更直接、也更不容易因为无关的 mock 细节而误报。
 *
 * 复审补: Remotion 选路开关的条件从内联的 `mode === 'ppt-narration' || mode ===
 * 'illustration-tts'` 改成了共享常量 `isRemotionReadyMode`(与 PATCH /[id] 路由
 * 共用, 见 renderer.ts), 源码正则锚不到"哪些 mode 在清单里"这件事本身了——这部分
 * 改成直接调真实的 isRemotionReadyMode/REMOTION_READY_MODES 断言, 逻辑锚点(调用
 * 哪个 handler)继续用源码正则。
 *
 * 二十九期 Task 4 补: talking-head-broll 也接上了 Remotion handler
 * (`handleTalkingHeadBrollRemotion`), Remotion 选路开关内部从"两选一"变成
 * "三选一"(`if/else if/else`), 下面 6 格里的这一格从"落回旧链"改成"走新 handler"。
 *
 * 6 格对应关系(与 handleProduce dispatch 段的实际代码一一对应):
 *   renderer=remotion  × mode=ppt-narration      → handlePptNarrationRemotion
 *   renderer=remotion  × mode=illustration-tts   → handleIllustrationTtsRemotion
 *   renderer=remotion  × mode=talking-head-broll → handleTalkingHeadBrollRemotion
 *   renderer=legacy    × mode=ppt-narration      → handlePptNarration
 *   renderer=legacy    × mode=illustration-tts   → handleIllustrationTts
 *   renderer=legacy    × mode=talking-head-broll → handleTalkingHeadBroll
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

// Remotion 选路开关的整段 if 块——从条件判断开始, 到与之配对的 return 结束。
const REMOTION_GATE_START = DISPATCH.indexOf(
  "if (vp.renderer === 'remotion' && isRemotionReadyMode(vp.mode))",
);
const REMOTION_GATE_END = DISPATCH.indexOf('\n      return;\n    }', REMOTION_GATE_START);
if (REMOTION_GATE_START < 0 || REMOTION_GATE_END < 0) {
  throw new Error('测试锚点失效: 找不到 Remotion 选路开关的 if 边界');
}
const REMOTION_GATE = DISPATCH.slice(REMOTION_GATE_START, REMOTION_GATE_END);

// 旧链 if/else-if 链——从 Remotion 开关结束后到文字叠加层开始之前。
const LEGACY_CHAIN_START = REMOTION_GATE_END;
const LEGACY_CHAIN_END = DISPATCH.indexOf('文字叠加层', LEGACY_CHAIN_START);
if (LEGACY_CHAIN_END < 0) {
  throw new Error('测试锚点失效: 找不到旧链 if/else-if 到文字叠加层之间的边界');
}
const LEGACY_CHAIN = DISPATCH.slice(LEGACY_CHAIN_START, LEGACY_CHAIN_END);

describe('选路矩阵: mode × renderer 共 6 格', () => {
  it('renderer=remotion × mode=ppt-narration → handlePptNarrationRemotion', () => {
    expect(isRemotionReadyMode('ppt-narration')).toBe(true);
    expect(REMOTION_GATE).toMatch(
      /if \(vp\.mode === 'ppt-narration'\) \{\s*await handlePptNarrationRemotion\(/,
    );
  });

  it('renderer=remotion × mode=illustration-tts → handleIllustrationTtsRemotion', () => {
    // 这一断言就是变异靶子: 把 illustration-tts 从 REMOTION_READY_MODES 里
    // 去掉, 这里直接变红——不用真的跑一遍 handleProduce 也能验证清单被改坏。
    expect(isRemotionReadyMode('illustration-tts')).toBe(true);
    expect(REMOTION_GATE).toMatch(
      /\} else if \(vp\.mode === 'illustration-tts'\) \{\s*await handleIllustrationTtsRemotion\(/,
    );
  });

  it('renderer=remotion × mode=talking-head-broll → handleTalkingHeadBrollRemotion(二十九期 Task 4 起接上)', () => {
    // 这一断言同样是变异靶子: 把 talking-head-broll 从 REMOTION_READY_MODES 里
    // 去掉, 这里直接变红。
    expect(isRemotionReadyMode('talking-head-broll')).toBe(true);
    expect(REMOTION_GATE).toMatch(
      /\} else \{\s*await handleTalkingHeadBrollRemotion\(/,
    );
  });

  it('renderer=legacy(或任意非 remotion 值) × mode=ppt-narration → handlePptNarration', () => {
    expect(LEGACY_CHAIN).toMatch(
      /\} else if \(vp\.mode === 'ppt-narration'\) \{\s*await handlePptNarration\(/,
    );
  });

  it('renderer=legacy × mode=illustration-tts → handleIllustrationTts(旧链, 非 Remotion 版)', () => {
    expect(LEGACY_CHAIN).toMatch(
      /\} else if \(vp\.mode === 'illustration-tts'\) \{\s*await handleIllustrationTts\(/,
    );
    // 防止误配成 Remotion 版——旧链这一格必须调用不带 Remotion 后缀的旧函数。
    expect(LEGACY_CHAIN).not.toMatch(/handleIllustrationTtsRemotion/);
  });

  it('renderer=legacy × mode=talking-head-broll → handleTalkingHeadBroll(旧链, 非 Remotion 版)', () => {
    expect(LEGACY_CHAIN).toMatch(
      /if \(vp\.mode === 'talking-head-broll'\) \{\s*await handleTalkingHeadBroll\(/,
    );
    // 防止误配成 Remotion 版——旧链这一格必须调用不带 Remotion 后缀的旧函数。
    expect(LEGACY_CHAIN).not.toMatch(/handleTalkingHeadBrollRemotion/);
  });

  it('未知 mode 落到 else 分支, 显式抛错而不是静默跳过', () => {
    expect(LEGACY_CHAIN).toMatch(/\} else \{\s*throw new Error\(`暂不支持的交付模式/);
  });
});

describe('REMOTION_READY_MODES 清单本身', () => {
  it('三个交付模式都在清单里(二十九期 Task 4 起 talking-head-broll 加入)', () => {
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
