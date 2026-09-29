import { describe, expect, it } from 'vitest';
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
});
