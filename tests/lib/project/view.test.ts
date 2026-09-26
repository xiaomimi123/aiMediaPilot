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
