import { describe, it, expect } from 'vitest';
import { computeStepNodes } from '@/lib/cockpit/stage-stepper';
import type { WorkStage } from '@/lib/cockpit/model';

const DEFAULT_FLOW: WorkStage[] = [
  'topic',
  'script',
  'recording',
  'editing',
  'publishing',
  'review',
];

const XHS_FLOW: WorkStage[] = ['topic', 'script', 'publishing'];

describe('computeStepNodes', () => {
  it('currentStage 在 flow 中间: 之前 done, 自身 current, 之后 upcoming', () => {
    expect(computeStepNodes(DEFAULT_FLOW, 'recording')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'done' },
      { stage: 'recording', status: 'current' },
      { stage: 'editing', status: 'upcoming' },
      { stage: 'publishing', status: 'upcoming' },
      { stage: 'review', status: 'upcoming' },
    ]);
  });

  it('currentStage = archived: 全部 done', () => {
    expect(computeStepNodes(DEFAULT_FLOW, 'archived')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'done' },
      { stage: 'recording', status: 'done' },
      { stage: 'editing', status: 'done' },
      { stage: 'publishing', status: 'done' },
      { stage: 'review', status: 'done' },
    ]);
  });

  it('currentStage = flow 首项 (topic): 自身 current, 其余 upcoming', () => {
    expect(computeStepNodes(DEFAULT_FLOW, 'topic')).toEqual([
      { stage: 'topic', status: 'current' },
      { stage: 'script', status: 'upcoming' },
      { stage: 'recording', status: 'upcoming' },
      { stage: 'editing', status: 'upcoming' },
      { stage: 'publishing', status: 'upcoming' },
      { stage: 'review', status: 'upcoming' },
    ]);
  });

  it('currentStage 不在 flow 中且非 archived, 排在 flow 之前 (inbox): 全部 upcoming', () => {
    expect(computeStepNodes(DEFAULT_FLOW, 'inbox')).toEqual([
      { stage: 'topic', status: 'upcoming' },
      { stage: 'script', status: 'upcoming' },
      { stage: 'recording', status: 'upcoming' },
      { stage: 'editing', status: 'upcoming' },
      { stage: 'publishing', status: 'upcoming' },
      { stage: 'review', status: 'upcoming' },
    ]);
  });

  it('小红书 3 步 flow: currentStage 在中间', () => {
    expect(computeStepNodes(XHS_FLOW, 'script')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'current' },
      { stage: 'publishing', status: 'upcoming' },
    ]);
  });

  it('小红书 3 步 flow: currentStage = archived: 全部 done', () => {
    expect(computeStepNodes(XHS_FLOW, 'archived')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'done' },
      { stage: 'publishing', status: 'done' },
    ]);
  });

  it('小红书 3 步 flow: currentStage = 首项 (topic): 自身 current, 其余 upcoming', () => {
    expect(computeStepNodes(XHS_FLOW, 'topic')).toEqual([
      { stage: 'topic', status: 'current' },
      { stage: 'script', status: 'upcoming' },
      { stage: 'publishing', status: 'upcoming' },
    ]);
  });

  it('小红书 3 步 flow: currentStage = 末项 (publishing): 之前 done, 自身 current', () => {
    expect(computeStepNodes(XHS_FLOW, 'publishing')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'done' },
      { stage: 'publishing', status: 'current' },
    ]);
  });

  it('小红书 3 步 flow: currentStage 脱离流的脏值 (recording, 不在此 flow 中但排在 flow 之后): 全部 done', () => {
    expect(computeStepNodes(XHS_FLOW, 'recording')).toEqual([
      { stage: 'topic', status: 'done' },
      { stage: 'script', status: 'done' },
      { stage: 'publishing', status: 'done' },
    ]);
  });
});
