import { describe, expect, it } from 'vitest';
import { createFromOwnScript, createProject } from '@/lib/project/create';
import { splitOriginal } from '@/lib/script/polish';

function fakeDb() {
  const projects: Record<string, unknown>[] = [];
  const samples: Record<string, unknown>[] = [];
  const db = {
    personaProfile: { findUnique: async () => ({ id: 'me', updatedAt: new Date('2026-10-01') }) },
    project: { create: async ({ data }: { data: Record<string, unknown> }) => { const p = { id: `p${projects.length + 1}`, ...data }; projects.push(p); return p; } },
    voiceSample: { create: async ({ data }: { data: Record<string, unknown> }) => (samples.push(data), data) },
  };
  return { db: db as never, projects, samples };
}

const original = '我是一名程序员。两年半前开始用AI写代码。做了个小工具。结果库存清空了。后来先写测试。我擅长描述问题。';

describe('createProject', () => {
  it('creates an untitled project with the persona snapshot', async () => {
    const { db, projects } = fakeDb();
    await createProject(db);
    expect(projects[0]).toMatchObject({ title: '未命名项目', personaSnapshot: { id: 'me' } });
    expect(projects[0]).not.toHaveProperty('script');
  });
});

describe('createFromOwnScript', () => {
  it('creates a project with a given script and saves the original as a sample', async () => {
    const { db, projects, samples } = fakeDb();
    const script = splitOriginal(original);
    await createFromOwnScript(db, { title: ' 两年半 ', script, targetSec: 90, originalText: original });
    expect(projects[0]).toMatchObject({ title: '两年半', script, targetSec: 90 });
    expect(samples[0]).toMatchObject({ title: '两年半', text: original, source: 'own_script' });
  });
  it('names an untitled project after the start of the original', async () => {
    const { db, projects } = fakeDb();
    await createFromOwnScript(db, { script: splitOriginal(original), targetSec: 75, originalText: original });
    expect(projects[0]).toMatchObject({ title: '我是一名程序员' });
  });
  it('rejects a text too short to fill 6 segments', async () => {
    const { db, projects } = fakeDb();
    await expect(createFromOwnScript(db, { script: splitOriginal('你好'), targetSec: 75, originalText: '你好' })).rejects.toThrow('稿子太短');
    expect(projects).toEqual([]);
  });
  it('rejects a script that is not 6 segments', async () => {
    const { db } = fakeDb();
    await expect(createFromOwnScript(db, { script: { segments: [] } as never, targetSec: 75, originalText: original })).rejects.toThrow('稿子格式不对');
  });
});
