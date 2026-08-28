import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_STAGES, stageIndex, waitingOn, isInFlight, stageHint,
} from '@/lib/cockpit/production-stage';

describe('waitingOn —— 「等你」和「在跑」必须分开', () => {
  it('**预览就绪是等你, 不是在跑** —— 混为一谈时 9 条任务停了半个多月没人发现', () => {
    expect(waitingOn('preview_ready')).toBe('you');
    expect(isInFlight('preview_ready')).toBe(false);
  });

  it('失败也是等你 —— 要你决定重不重来', () => {
    expect(waitingOn('failed')).toBe('you');
  });

  it('没开工的等你点开始制作', () => {
    expect(waitingOn('queued')).toBe('you');
    expect(waitingOn('source_uploaded')).toBe('you');
  });

  it('中间各步是机器在跑', () => {
    for (const s of ['directing', 'building', 'assembling', 'approved', 'rendering', 'packaging']) {
      expect(waitingOn(s)).toBe('machine');
      expect(isInFlight(s)).toBe(true);
    }
  });

  it('完成了谁也不等', () => {
    expect(waitingOn('done')).toBe('nobody');
    expect(isInFlight('done')).toBe(false);
  });
});

describe('stageIndex', () => {
  it('按流程顺序递增', () => {
    expect(stageIndex('queued')).toBe(0);
    expect(stageIndex('preview_ready')).toBeGreaterThan(stageIndex('building'));
    expect(stageIndex('done')).toBe(PRODUCTION_STAGES.length - 1);
  });

  it('approved 和 rendering 是同一阶段 —— 确认之后就是在渲染', () => {
    expect(stageIndex('approved')).toBe(stageIndex('rendering'));
  });

  it('source_uploaded 归排队 —— 传了视频不等于开工了', () => {
    expect(stageIndex('source_uploaded')).toBe(stageIndex('queued'));
  });

  it('**failed 不落在任何阶段上** —— 不能把失败画成"进行到某一步"', () => {
    expect(stageIndex('failed')).toBe(-1);
    expect(stageIndex('乱七八糟')).toBe(-1);
  });
});

describe('stageHint', () => {
  it('预览就绪要明说它会一直停在这儿', () => {
    expect(stageHint('preview_ready')).toContain('确认导出');
    expect(stageHint('preview_ready')).toContain('一直停');
  });

  it('每个已知状态都有话说, 不留空字符串', () => {
    for (const s of ['queued', 'source_uploaded', 'directing', 'building', 'assembling',
                     'preview_ready', 'approved', 'rendering', 'packaging', 'done', 'failed']) {
      expect(stageHint(s).length).toBeGreaterThan(0);
    }
  });
});
