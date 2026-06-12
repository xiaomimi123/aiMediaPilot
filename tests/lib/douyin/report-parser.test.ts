import { describe, expect, it } from 'vitest';
import path from 'path';
import { parseReportMd } from '@/lib/douyin/report-parser';

const FIXTURE = path.join(__dirname, '../../fixtures/douyin-report-sample.md');

describe('parseReportMd', () => {
  it('解析 5 个核心字段 (真实 cheat-on-content 格式: 2.5w/分享/全角:)', async () => {
    const r = await parseReportMd(FIXTURE);
    // "2.5w" → 25000
    expect(r.plays).toBe(25000n);
    expect(r.likes).toBe(125n);
    expect(r.comments).toBe(20n);
    // 「分享」 not 「转发」
    expect(r.shares).toBe(11n);
    expect(r.collects).toBe(32n);
  });

  it('留存指标默认 null (cheat-on-content renderer 不输出到 markdown 平文)', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.completionRateBp).toBeNull();
    expect(r.retention3sBp).toBeNull();
    expect(r.followConversionBp).toBeNull();
  });

  it('计算 3 个派生比率 Bp', async () => {
    const r = await parseReportMd(FIXTURE);
    // 125 / 25000 = 0.5% → 50 Bp
    expect(r.likeRateBp).toBe(50);
    // 20 / 25000 = 0.08% → 8 Bp
    expect(r.commentRateBp).toBe(8);
    // 11 / 25000 = 0.044% → 4 Bp
    expect(r.shareRateBp).toBe(4);
  });

  it('解析评论 [👍N] / [👍N 💬M] 格式', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.topComments).toHaveLength(5);
    expect(r.topComments?.[0]).toEqual({ text: '这个我也踩过！', likes: 12 });
    expect(r.topComments?.[1]).toEqual({ text: '很好很有用', likes: 8 });
    expect(r.topComments?.[3]).toEqual({ text: '期待下一期', likes: 0 });
    expect(r.topComments?.[4]).toEqual({ text: '大佬讲讲下个话题吧', likes: 0 });
  });

  it('parseChineseNum: 整数、w、亿、千分位、负 case', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const pathMod = await import('path');
    const tmpPath = pathMod.join(os.tmpdir(), `chinese-num-${Date.now()}.md`);
    await fs.writeFile(tmpPath, [
      '## 播放数据',
      '- 播放：1.5亿',
      '- 点赞：12,345',
      '- 评论：500',
      '- 收藏：0',
      '- 分享：3.7w',
      '',
    ].join('\n'));
    try {
      const r = await parseReportMd(tmpPath);
      expect(r.plays).toBe(150_000_000n);
      expect(r.likes).toBe(12345n);
      expect(r.comments).toBe(500n);
      expect(r.collects).toBe(0n);
      expect(r.shares).toBe(37000n);
    } finally {
      await fs.unlink(tmpPath);
    }
  });

  it('字段值为「-」抛错 (cheat 在数据 None 时输出 -)', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const pathMod = await import('path');
    const tmpPath = pathMod.join(os.tmpdir(), `dash-num-${Date.now()}.md`);
    await fs.writeFile(tmpPath, '## 播放数据\n- 播放：-\n- 点赞：10\n- 评论：1\n- 分享：0\n- 收藏：0\n');
    try {
      await expect(parseReportMd(tmpPath)).rejects.toThrow(/值无效/);
    } finally {
      await fs.unlink(tmpPath);
    }
  });

  it('核心字段缺失 (e.g. 分享) 抛错', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const pathMod = await import('path');
    const tmpPath = pathMod.join(os.tmpdir(), `missing-share-${Date.now()}.md`);
    await fs.writeFile(tmpPath, '## 播放数据\n- 播放：100\n- 点赞：10\n- 评论：1\n- 收藏：0\n');
    try {
      await expect(parseReportMd(tmpPath)).rejects.toThrow(/缺少必填字段: 分享/);
    } finally {
      await fs.unlink(tmpPath);
    }
  });
});
