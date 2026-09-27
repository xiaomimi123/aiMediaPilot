import { describe, expect, it } from 'vitest';
import { toProjectView, toMessageView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

describe('toProjectView', () => {
  it('attaches a duration report when script is valid', () => {
    const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(10) })) };
    const v = toProjectView({ id: 'p1', title: 't', stage: 'draft', targetSec: 60, script, updatedAt: new Date('2026-09-27T00:00:00Z') });
    expect(v.report?.totalSec).toBe(12);
    expect(v.updatedAt).toBe('2026-09-27T00:00:00.000Z');
  });
  it('returns null script/report for malformed or empty script', () => {
    const v = toProjectView({ id: 'p1', title: 't', stage: 'draft', targetSec: 60, script: { foo: 1 }, updatedAt: new Date() });
    expect(v.script).toBeNull();
    expect(v.report).toBeNull();
  });
});

describe('toMessageView', () => {
  it('reads ok from toolResult for tool rows', () => {
    expect(toMessageView({ id: 'm1', role: 'tool', content: '改稿', toolName: 'patch_script', toolResult: { ok: false } }).ok).toBe(false);
    expect(toMessageView({ id: 'm2', role: 'user', content: 'hi', toolName: null, toolResult: null }).ok).toBeNull();
  });
});

import { buildRecordingView, toJobView } from '@/lib/project/view';

describe('buildRecordingView', () => {
  const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: ['开场白', '第一点', '第二点', '冷知识内容', '串起来', '收个尾'][i] })) };
  it('returns null when no video was uploaded', () => {
    expect(buildRecordingView('p1', script, null, null)).toBeNull();
  });
  it('builds the video url and marks adlib lines and skipped segments by Chinese name', () => {
    const transcript = {
      lines: ['开场白', '第一点', '第二点', '串起来', '收个尾', '顺便说个题外话'].map((text, i) => ({ startSec: i, endSec: i + 1, text })),
      rawLines: [],
      durationSec: 6,
      proofread: 'done' as const,
    };
    const v = buildRecordingView('p1', script, { id: 'f9', meta: { durationSec: 6.2 } }, transcript)!;
    expect(v.videoUrl).toBe('/api/projects/p1/files/f9');
    expect(v.durationSec).toBe(6.2);
    expect(v.transcript?.lines.at(-1)).toMatchObject({ text: '顺便说个题外话', adlib: true });
    expect(v.transcript?.skipped).toEqual(['冷知识']);
  });
});

describe('toJobView / toMessageView for system rows', () => {
  it('exposes only the fields the UI needs', () => {
    expect(toJobView({ id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.3, userMessage: '坏了', errorDetail: 'stack' })).toEqual({
      id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.3, userMessage: '坏了', errorDetail: 'stack',
    });
  });
  it('reads ok for job notices stored as system rows', () => {
    expect(toMessageView({ id: 'm1', role: 'system', content: '转写完成', toolName: 'job:transcribe', toolResult: { ok: true } }).ok).toBe(true);
    expect(toMessageView({ id: 'm2', role: 'system', content: '连不上', toolName: null, toolResult: null }).ok).toBeNull();
  });
});
