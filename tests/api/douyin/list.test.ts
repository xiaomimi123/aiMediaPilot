import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/douyin/list', () => ({
  runDouyinListAdapter: vi.fn(),
}));

import { GET } from '@/app/api/v1/douyin/list/route';
import { runDouyinListAdapter } from '@/lib/douyin/list';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/douyin/list', () => {
  it('成功 → 200 + items 数组', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890123456789', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'x' },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].awemeId).toBe('7234567890123456789');
  });

  it('adapter 抛错 → 500 + 友好 message', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cookie expired'));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/cookie expired|抖音列表拉取失败|登录/);
  });
});
