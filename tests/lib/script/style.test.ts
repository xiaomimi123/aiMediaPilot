import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  styleProfile: { findUnique: vi.fn() },
  styleSample: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  scriptDraft: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { pickStyleMode, getStyleContext, depositStyleSample } from '@/lib/script/style';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pickStyleMode', () => {
  it('0 篇 → description', () => {
    expect(pickStyleMode(0)).toBe('description');
  });
  it('1 篇 → description', () => {
    expect(pickStyleMode(1)).toBe('description');
  });
  it('2 篇 → samples', () => {
    expect(pickStyleMode(2)).toBe('samples');
  });
  it('3 篇 → samples', () => {
    expect(pickStyleMode(3)).toBe('samples');
  });
});

describe('getStyleContext', () => {
  it('样本数 <2 → description 模式, description 无档案则为空串', async () => {
    prismaMock.styleProfile.findUnique.mockResolvedValue(null);
    prismaMock.styleSample.findMany.mockResolvedValue([]);
    prismaMock.styleSample.count.mockResolvedValue(0);

    const out = await getStyleContext('u1', 'douyin');

    expect(out).toEqual({ mode: 'description', description: '', samples: [] });
    expect(prismaMock.styleProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prismaMock.styleSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', platform: 'douyin' } })
    );
  });

  it('样本数 <2 → description 模式, 有档案则带说明文字', async () => {
    prismaMock.styleProfile.findUnique.mockResolvedValue({ userId: 'u1', description: '语速快, 爱用反问句' });
    prismaMock.styleSample.findMany.mockResolvedValue([{ content: '样本一' }]);
    prismaMock.styleSample.count.mockResolvedValue(1);

    const out = await getStyleContext('u1', 'douyin');

    expect(out.mode).toBe('description');
    expect(out.description).toBe('语速快, 爱用反问句');
  });

  it('样本数 ≥2 → samples 模式, 取最近 3 篇内容, 仍带 description', async () => {
    prismaMock.styleProfile.findUnique.mockResolvedValue({ userId: 'u1', description: '语速快' });
    prismaMock.styleSample.findMany.mockResolvedValue([
      { content: '最新样本' },
      { content: '次新样本' },
      { content: '第三样本' },
    ]);
    prismaMock.styleSample.count.mockResolvedValue(5); // 总数 5, 只取最近 3

    const out = await getStyleContext('u1', 'douyin');

    expect(out.mode).toBe('samples');
    expect(out.description).toBe('语速快'); // samples 模式仍带 description
    expect(out.samples).toEqual(['最新样本', '次新样本', '第三样本']);
    expect(prismaMock.styleSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });
});

describe('depositStyleSample', () => {
  it('无 sections → false, 不创建样本', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      platform: 'douyin',
      output: { picked: {} }, // 无 script.sections
    });

    const out = await depositStyleSample('u1', 'd1');

    expect(out).toBe(false);
    expect(prismaMock.styleSample.create).not.toHaveBeenCalled();
  });

  it('output 为 null/非对象 → false', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      platform: 'douyin',
      output: null,
    });

    const out = await depositStyleSample('u1', 'd1');

    expect(out).toBe(false);
  });

  it('草稿不存在 (或不属于该用户) → false', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue(null);

    const out = await depositStyleSample('u1', 'missing');

    expect(out).toBe(false);
    expect(prismaMock.styleSample.create).not.toHaveBeenCalled();
  });

  it('已存在同 sourceScriptDraftId 样本 → 覆盖更新 content, 不 create, 返回 true (用户裁决: 覆盖而非跳过)', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      platform: 'douyin',
      output: {
        script: {
          sections: [
            { role: 'hook', startSec: 0, endSec: 3, text: '改稿后的开场白' },
            { role: 'cta', startSec: 3, endSec: 6, text: '改稿后的点赞关注' },
          ],
        },
      },
    });
    prismaMock.styleSample.findFirst.mockResolvedValue({ id: 'existing-sample', content: '旧的初稿文本' });
    prismaMock.styleSample.update.mockResolvedValue({ id: 'existing-sample' });

    const out = await depositStyleSample('u1', 'd1');

    expect(out).toBe(true);
    expect(prismaMock.styleSample.create).not.toHaveBeenCalled();
    expect(prismaMock.styleSample.update).toHaveBeenCalledWith({
      where: { id: 'existing-sample' },
      data: { content: '改稿后的开场白\n改稿后的点赞关注' },
    });
  });

  it('正常路径: 有 sections 且未存过 → 拼接 text 存样本, 返回 true', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      platform: 'douyin',
      output: {
        script: {
          sections: [
            { role: 'hook', startSec: 0, endSec: 3, text: '开场白' },
            { role: 'main', startSec: 3, endSec: 20, text: '正文内容' },
            { role: 'cta', startSec: 20, endSec: 25, text: '点赞关注' },
          ],
        },
      },
    });
    prismaMock.styleSample.findFirst.mockResolvedValue(null);
    prismaMock.styleSample.create.mockResolvedValue({ id: 'new-sample' });

    const out = await depositStyleSample('u1', 'd1');

    expect(out).toBe(true);
    expect(prismaMock.styleSample.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        platform: 'douyin',
        content: '开场白\n正文内容\n点赞关注',
        sourceScriptDraftId: 'd1',
      },
    });
  });

  it('sections 为空数组 → false', async () => {
    prismaMock.scriptDraft.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      platform: 'douyin',
      output: { script: { sections: [] } },
    });

    const out = await depositStyleSample('u1', 'd1');

    expect(out).toBe(false);
  });
});
