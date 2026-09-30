import { describe, expect, it, vi } from 'vitest';
import { finalizeScript } from '@/lib/script/finalize';
import { createFakeDb } from '../../helpers/fake-db';
import { SEGMENT_ROLES } from '@/lib/script/model';

const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字' })) };

describe('finalizeScript', () => {
  it('moves the project to scripted', async () => {
    const { db, project } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1');
    expect(project.stage).toBe('scripted');
  });
  it('never moves a project backwards', async () => {
    const { db, project } = createFakeDb({ project: { script, stage: 'recorded' } });
    await finalizeScript(db, 'p1');
    expect(project.stage).toBe('recorded');
  });
  it('refuses without a script', async () => {
    const { db } = createFakeDb();
    await expect(finalizeScript(db, 'p1')).rejects.toThrow('还没有稿子，不能定稿');
  });
  it('proposes a note only when moving draft → scripted', async () => {
    const propose = vi.fn(async () => {});
    const { db } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1', propose);
    await finalizeScript(db, 'p1', propose);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith('p1');
  });
  it('still finalizes when proposing fails', async () => {
    const { db, project } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1', async () => { throw new Error('boom'); });
    expect(project.stage).toBe('scripted');
  });
});
