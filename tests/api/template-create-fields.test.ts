import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
const prismaMock = vi.hoisted(() => ({
  videoTemplate: {
    create: vi.fn(async () => ({ id: 't1' })) as unknown as {
      (): Promise<{ id: string }>;
      mock: { calls: { 0: { data: Record<string, unknown> } }[] };
    },
    count: vi.fn(async () => 4),
    findMany: vi.fn(async () => []),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));

import { POST } from '@/app/api/v1/video-templates/route';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

/**
 * 锁住一次真实事故: 「从预设新建」把「真人口播 · 文字叠加」加进库之后, brollEnabled
 * 和 textOverlayEnabled 全落回了数据库默认值 —— 存进去变成 B-roll=true / 文字叠加=false,
 * 正好和预设相反。而这两个开关正是「像不像参考片」的全部区别。
 */
describe('POST /video-templates 必须原样写入所有配置字段', () => {
  beforeEach(() => vi.clearAllMocks());

  it('brollEnabled / textOverlayEnabled / personSide / aspect 都要落库', async () => {
    const preset = PRESET_TEMPLATES.find((p) => p.name === '真人口播 · 文字叠加')!;
    expect(preset.brollEnabled).toBe(false);
    expect(preset.textOverlayEnabled).toBe(true);

    const res = await POST(new Request('http://x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preset),
    }));
    expect(res.status).toBe(200);

    const data = prismaMock.videoTemplate.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.brollEnabled).toBe(false);
    expect(data.textOverlayEnabled).toBe(true);
    expect(data.personSide).toBe(preset.personSide);
  });

  it('画幅也要落库 —— 否则竖屏预设进库就变横屏', async () => {
    const preset = PRESET_TEMPLATES.find((p) => p.aspect === '9:16')!;
    await POST(new Request('http://x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preset),
    }));
    const d2 = prismaMock.videoTemplate.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(d2.aspect).toBe('9:16');
  });
});
