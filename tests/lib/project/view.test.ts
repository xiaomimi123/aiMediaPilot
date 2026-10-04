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

import { toMaterialView, toFilmView } from '@/lib/project/view';

describe('material / film views', () => {
  const mat = toMaterialView('p1', { id: 'fm', path: '/x/material-1.mov', meta: { note: '放这', originalName: 'rec.mov', mediaType: 'video', durationSec: 40 } });
  it('builds a material view with a file url', () => {
    expect(mat).toEqual({ id: 'fm', url: '/api/projects/p1/files/fm', mediaType: 'video', note: '放这', originalName: 'rec.mov', durationSec: 40 });
  });
  it('resolves material names in the usage table', () => {
    const film = toFilmView(
      'p1',
      { id: 'ff', path: '/x/final.v2.mp4', createdAt: new Date('2026-09-28T01:00:00Z'), meta: { filmVersion: 2, summary: '首版', usage: [{ materialId: 'fm', atSec: 5, durSec: 7, speed: 1.5 }, { materialId: 'gone', atSec: 12, durSec: 3 }] } },
      [mat],
    );
    expect(film).toMatchObject({ version: 2, url: '/api/projects/p1/files/ff', summary: '首版' });
    expect(film.usage).toEqual([
      { materialName: 'rec.mov', atSec: 5, durSec: 7, speed: 1.5 },
      { materialName: '（已删除的素材）', atSec: 12, durSec: 3 },
    ]);
  });
  it('exposes the film orientation, portrait when not recorded', () => {
    const base = { id: 'ff', path: '/x/f.mp4', createdAt: new Date('2026-10-04T00:00:00Z') };
    expect(toFilmView('p1', { ...base, meta: { filmVersion: 4, orientation: 'landscape' } }, []).orientation).toBe('landscape');
    expect(toFilmView('p1', { ...base, meta: { filmVersion: 1 } }, []).orientation).toBe('portrait');
  });
});

describe('toMessageView detail', () => {
  it('exposes the tool detail text', () => {
    expect(toMessageView({ id: 'm', role: 'tool', content: '概况', toolName: 'status', toolResult: { ok: true, data: { text: '粉丝 408' } } })).toMatchObject({ ok: true, detail: '粉丝 408' });
    expect(toMessageView({ id: 'm', role: 'user', content: 'x', toolName: null, toolResult: null }).detail).toBeNull();
  });
});

describe('toMessageView proposal', () => {
  it('exposes the note proposal id', () => {
    expect(toMessageView({ id: 'm', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', toolResult: { ok: true, proposalId: 'np1' } }).proposalId).toBe('np1');
    expect(toMessageView({ id: 'm', role: 'user', content: 'x', toolName: null, toolResult: null }).proposalId).toBeNull();
  });
});
