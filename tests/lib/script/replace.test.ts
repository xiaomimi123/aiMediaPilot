import { describe, expect, it } from 'vitest';
import { replaceScript } from '@/lib/script/edit';
import { splitOriginal } from '@/lib/script/polish';
import { createFakeDb } from '../../helpers/fake-db';

const old = splitOriginal('一。二。三。四。五。六。');
const polished = splitOriginal('甲。乙。丙。丁。戊。己。');

describe('replaceScript', () => {
  it('replaces a draft script and notes it in the chat', async () => {
    const { db, project, messages } = createFakeDb({ project: { script: old } });
    await replaceScript(db as never, 'p1', polished, '用了润色版（改动 3 处）');
    expect(project.script).toEqual(polished);
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: '用了润色版（改动 3 处）' });
  });
  it('refuses to replace the script after it is finalized', async () => {
    const { db, project } = createFakeDb({ project: { script: old, stage: 'scripted' } });
    await expect(replaceScript(db as never, 'p1', polished, 'x')).rejects.toThrow('已定稿的稿子不能直接替换');
    expect(project.script).toEqual(old);
  });
  it('rejects a malformed script', async () => {
    const { db } = createFakeDb({ project: { script: old } });
    await expect(replaceScript(db as never, 'p1', { segments: [] } as never, 'x')).rejects.toThrow('稿子格式不对');
  });
});
