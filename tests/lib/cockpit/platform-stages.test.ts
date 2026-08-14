import { describe, it, expect } from 'vitest';
import {
  PLATFORM_STAGE_FLOW,
  DEFAULT_STAGE_FLOW,
  stageFlowFor,
  stageLabelFor,
  nextActionFor,
  nextStageFor,
  isStageInFlow,
  schedulableStagesFor,
} from '@/lib/cockpit/platform-stages';
import { STAGE_LABELS, NEXT_ACTIONS, WORK_STAGES, CONTENT_STAGES } from '@/lib/cockpit/model';
import type { ContentStage } from '@/lib/cockpit/model';

describe('PLATFORM_STAGE_FLOW / DEFAULT_STAGE_FLOW', () => {
  it('xiaohongshu 流逐字 = inbox/topic/script/publishing/review', () => {
    expect(PLATFORM_STAGE_FLOW.xiaohongshu).toEqual([
      'inbox',
      'topic',
      'script',
      'publishing',
      'review',
    ]);
  });

  it('DEFAULT_STAGE_FLOW === WORK_STAGES (现状 7 阶段)', () => {
    expect(DEFAULT_STAGE_FLOW).toEqual(WORK_STAGES);
  });
});

describe('stageFlowFor', () => {
  it('xiaohongshu 返回专属流, 且保持顺序', () => {
    expect(stageFlowFor('xiaohongshu')).toEqual([
      'inbox',
      'topic',
      'script',
      'publishing',
      'review',
    ]);
  });

  it('douyin 走 DEFAULT (7 阶段)', () => {
    expect(stageFlowFor('douyin')).toEqual(WORK_STAGES);
  });

  it('未知平台走 DEFAULT', () => {
    expect(stageFlowFor('some-unknown-platform')).toEqual(WORK_STAGES);
  });
});

describe('stageLabelFor', () => {
  it('xhs 的 script 改写为「文案」', () => {
    expect(stageLabelFor('xiaohongshu', 'script')).toBe('文案');
  });

  it('xhs 的其余阶段回落全局 STAGE_LABELS', () => {
    (['inbox', 'topic', 'recording', 'editing', 'publishing', 'review', 'archived'] as ContentStage[]).forEach(
      (stage) => {
        expect(stageLabelFor('xiaohongshu', stage)).toBe(STAGE_LABELS[stage]);
      },
    );
  });

  it('douyin 的 script 不改写, 回落全局', () => {
    expect(stageLabelFor('douyin', 'script')).toBe(STAGE_LABELS.script);
  });

  it('对 archived 也工作 (回落全局表)', () => {
    expect(stageLabelFor('xiaohongshu', 'archived')).toBe(STAGE_LABELS.archived);
    expect(stageLabelFor('douyin', 'archived')).toBe(STAGE_LABELS.archived);
  });
});

describe('nextActionFor', () => {
  it('xhs 的 script 改写为「完成文案与配图」', () => {
    expect(nextActionFor('xiaohongshu', 'script')).toBe('完成文案与配图');
  });

  it('xhs 的其余阶段回落全局 NEXT_ACTIONS', () => {
    (['inbox', 'topic', 'recording', 'editing', 'publishing', 'review', 'archived'] as ContentStage[]).forEach(
      (stage) => {
        expect(nextActionFor('xiaohongshu', stage)).toBe(NEXT_ACTIONS[stage]);
      },
    );
  });

  it('douyin 的 script 不改写, 回落全局', () => {
    expect(nextActionFor('douyin', 'script')).toBe(NEXT_ACTIONS.script);
  });

  it('对 archived 也工作 (回落全局表)', () => {
    expect(nextActionFor('xiaohongshu', 'archived')).toBe(NEXT_ACTIONS.archived);
    expect(nextActionFor('douyin', 'archived')).toBe(NEXT_ACTIONS.archived);
  });
});

describe('isStageInFlow', () => {
  it('archived 不在任何平台的 flow 内', () => {
    expect(isStageInFlow('xiaohongshu', 'archived')).toBe(false);
    expect(isStageInFlow('douyin', 'archived')).toBe(false);
    expect(isStageInFlow('unknown', 'archived')).toBe(false);
  });

  it('xhs: recording/editing 不在流内, 其余在', () => {
    expect(isStageInFlow('xiaohongshu', 'recording')).toBe(false);
    expect(isStageInFlow('xiaohongshu', 'editing')).toBe(false);
    expect(isStageInFlow('xiaohongshu', 'inbox')).toBe(true);
    expect(isStageInFlow('xiaohongshu', 'topic')).toBe(true);
    expect(isStageInFlow('xiaohongshu', 'script')).toBe(true);
    expect(isStageInFlow('xiaohongshu', 'publishing')).toBe(true);
    expect(isStageInFlow('xiaohongshu', 'review')).toBe(true);
  });

  it('douyin/未知平台: 全部 WORK_STAGES 均在流内', () => {
    WORK_STAGES.forEach((stage) => {
      expect(isStageInFlow('douyin', stage)).toBe(true);
      expect(isStageInFlow('some-unknown-platform', stage)).toBe(true);
    });
  });
});

describe('nextStageFor 矩阵', () => {
  it('xhs: script → publishing (跳过录制/剪辑, 修死阶段 bug)', () => {
    expect(nextStageFor('xiaohongshu', 'script')).toBe('publishing');
  });

  it('douyin: script → recording (现状回归)', () => {
    expect(nextStageFor('douyin', 'script')).toBe('recording');
  });

  it('xhs 流内其余顺序: inbox→topic→script→publishing→review', () => {
    expect(nextStageFor('xiaohongshu', 'inbox')).toBe('topic');
    expect(nextStageFor('xiaohongshu', 'topic')).toBe('script');
    expect(nextStageFor('xiaohongshu', 'publishing')).toBe('review');
  });

  it('xhs 流外脏值: recording → publishing (全集顺序找流内第一个后继)', () => {
    expect(nextStageFor('xiaohongshu', 'recording')).toBe('publishing');
  });

  it('xhs 流外脏值: editing → publishing', () => {
    expect(nextStageFor('xiaohongshu', 'editing')).toBe('publishing');
  });

  it('review 是流尾 → null (不自动归档, 同现状边界)', () => {
    expect(nextStageFor('xiaohongshu', 'review')).toBe(null);
    expect(nextStageFor('douyin', 'review')).toBe(null);
  });

  it('archived → null (各平台一律)', () => {
    expect(nextStageFor('xiaohongshu', 'archived')).toBe(null);
    expect(nextStageFor('douyin', 'archived')).toBe(null);
    expect(nextStageFor('unknown-platform', 'archived')).toBe(null);
  });

  it('未知平台照全集 (WORK_STAGES 顺序) 逐级推进', () => {
    expect(nextStageFor('unknown-platform', 'inbox')).toBe('topic');
    expect(nextStageFor('unknown-platform', 'topic')).toBe('script');
    expect(nextStageFor('unknown-platform', 'script')).toBe('recording');
    expect(nextStageFor('unknown-platform', 'recording')).toBe('editing');
    expect(nextStageFor('unknown-platform', 'editing')).toBe('publishing');
    expect(nextStageFor('unknown-platform', 'publishing')).toBe('review');
    expect(nextStageFor('unknown-platform', 'review')).toBe(null);
  });

  it('全集穷举: 每个 (platform, stage) 组合的返回值要么是 null 要么是合法 ContentStage 且不等于 stage 本身', () => {
    const platforms = ['xiaohongshu', 'douyin', 'gongzhonghao', 'unknown-platform'];
    platforms.forEach((platform) => {
      CONTENT_STAGES.forEach((stage) => {
        const next = nextStageFor(platform, stage);
        if (next !== null) {
          expect(CONTENT_STAGES).toContain(next);
          expect(next).not.toBe(stage);
        }
      });
    });
  });
});

describe('schedulableStagesFor', () => {
  it('xhs = topic/script/publishing (recording/editing 剔除, 保持 SCHEDULABLE 顺序)', () => {
    expect(schedulableStagesFor('xiaohongshu')).toEqual(['topic', 'script', 'publishing']);
  });

  it('douyin/未知平台 = 全部 SCHEDULABLE_STAGES', () => {
    expect(schedulableStagesFor('douyin')).toEqual([
      'topic',
      'script',
      'recording',
      'editing',
      'publishing',
    ]);
    expect(schedulableStagesFor('unknown-platform')).toEqual([
      'topic',
      'script',
      'recording',
      'editing',
      'publishing',
    ]);
  });
});
