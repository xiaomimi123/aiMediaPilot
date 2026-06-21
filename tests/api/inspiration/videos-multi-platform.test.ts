import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  inspirationVideo: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/inspiration/public-video-adapter', () => ({
  fetchPublicVideo: vi.fn(),
}));

vi.mock('@/lib/inspiration/short-link-resolver', () => ({
  resolveDouyinShortLink: vi.fn(),
}));

import { POST } from '@/app/api/v1/inspiration/videos/route';
import { fetchPublicVideo } from '@/lib/inspiration/public-video-adapter';
import { resolveDouyinShortLink } from '@/lib/inspiration/short-link-resolver';

function reqJSON(body: unknown): Request {
  return new Request('http://t/api/v1/inspiration/videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inspirationVideo.findFirst.mockResolvedValue(null);
  prismaMock.inspirationVideo.create.mockResolvedValue({ id: 'v1' });
});

describe('POST /api/v1/inspiration/videos — multi-platform', () => {
  it('XHS URL + manualMetadata → 200 platform=xiaohongshu source=manual', async () => {
    const res = await POST(
      reqJSON({
        url: 'https://www.xiaohongshu.com/explore/65f8a1b2000000001234567890abcdef',
        manualMetadata: { title: '测试笔记标题', authorName: 'xhs-user', likeCount: 1234 },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('xiaohongshu');
    expect(json.data.source).toBe('manual');
    // 应该没调过 douyin crawler
    expect(fetchPublicVideo).not.toHaveBeenCalled();
    // 写入应该用 platform=xiaohongshu
    expect(prismaMock.inspirationVideo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platform: 'xiaohongshu',
          title: '测试笔记标题',
          authorName: 'xhs-user',
          likeCount: 1234n,
        }),
      }),
    );
  });

  it('XHS URL 不带 manualMetadata → 422', async () => {
    const res = await POST(
      reqJSON({ url: 'https://www.xiaohongshu.com/explore/65f8a1b2000000001234567890abcdef' }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.message).toContain('小红书');
  });

  it('公众号 URL + manualMetadata → 200 platform=gongzhonghao', async () => {
    const res = await POST(
      reqJSON({
        url: 'https://mp.weixin.qq.com/s/Abc-Def_xyz123XYZ',
        manualMetadata: { title: '公众号测试文章' },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.platform).toBe('gongzhonghao');
    expect(prismaMock.inspirationVideo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platform: 'gongzhonghao' }),
      }),
    );
  });

  it('Douyin URL → 调 fetchPublicVideo, 成功时 source=auto', async () => {
    (fetchPublicVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
      awemeId: '7234567890123456789',
      title: '抖音爆款',
      authorName: '某博主',
      diggCount: 5000,
      playCount: 100000,
      commentCount: 200,
      shareCount: 50,
      durationMs: 60000,
      createTime: 1718000000,
    });
    const res = await POST(reqJSON({ url: 'https://www.douyin.com/video/7234567890123456789' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.platform).toBe('douyin');
    expect(json.data.source).toBe('auto');
    expect(fetchPublicVideo).toHaveBeenCalledWith('7234567890123456789');
  });

  it('Douyin 短链 → 调 resolveDouyinShortLink 解析', async () => {
    (resolveDouyinShortLink as ReturnType<typeof vi.fn>).mockResolvedValue({
      awemeId: '7234567890123456789',
      finalUrl: 'https://www.douyin.com/video/7234567890123456789',
    });
    (fetchPublicVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
      awemeId: '7234567890123456789',
      title: '抖音爆款',
    });
    const res = await POST(reqJSON({ url: 'https://v.douyin.com/JEXNRNoEuIY/' }));
    expect(res.status).toBe(200);
    expect(resolveDouyinShortLink).toHaveBeenCalledWith('https://v.douyin.com/JEXNRNoEuIY/');
  });

  it('不能识别的 URL → 400', async () => {
    const res = await POST(reqJSON({ url: 'https://example.com/foo' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('无法识别');
  });

  it('重复 (userId, platform, awemeId) → 409', async () => {
    prismaMock.inspirationVideo.findFirst.mockResolvedValue({ id: 'existing' });
    const res = await POST(
      reqJSON({
        url: 'https://www.xiaohongshu.com/explore/65f8a1b2000000001234567890abcdef',
        manualMetadata: { title: '重复测试' },
      }),
    );
    expect(res.status).toBe(409);
  });
});
