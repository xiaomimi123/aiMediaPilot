import { describe, expect, it } from 'vitest';
import path from 'path';
import { parseReportMd } from '@/lib/douyin/report-parser';

const FIXTURE = path.join(__dirname, '../../fixtures/douyin-report-sample.md');

describe('parseReportMd', () => {
  it('解析所有 8 个核心 + 留存字段', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.plays).toBe(12345n);
    expect(r.likes).toBe(1234n);
    expect(r.comments).toBe(234n);
    expect(r.shares).toBe(45n);
    expect(r.collects).toBe(123n);
    expect(r.completionRateBp).toBe(3210);
    expect(r.retention3sBp).toBe(6540);
    expect(r.followConversionBp).toBe(120);
  });

  it('计算 3 个派生比率 Bp', async () => {
    const r = await parseReportMd(FIXTURE);
    // 1234 / 12345 = 9.9959...% ≈ 999 Bp
    expect(r.likeRateBp).toBeGreaterThanOrEqual(990);
    expect(r.likeRateBp).toBeLessThanOrEqual(1010);
    // 234 / 12345 = 1.895...% ≈ 189
    expect(r.commentRateBp).toBeGreaterThanOrEqual(180);
    expect(r.commentRateBp).toBeLessThanOrEqual(200);
    // 45 / 12345 = 0.364...% ≈ 36
    expect(r.shareRateBp).toBeGreaterThanOrEqual(30);
    expect(r.shareRateBp).toBeLessThanOrEqual(40);
  });

  it('解析 Top 5 评论 (含赞数)', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.topComments).toHaveLength(5);
    expect(r.topComments?.[0]).toEqual({ text: '这个我也踩过!', likes: 123 });
    expect(r.topComments?.[4]).toEqual({ text: '期待下一期', likes: 32 });
  });

  it('缺失字段返回 null 不抛错', async () => {
    const tmpPath = path.join(__dirname, 'minimal-report.md');
    const fs = await import('fs/promises');
    await fs.writeFile(tmpPath, '# 视频复盘报告\n## 数据快照\n- 播放: 100\n- 点赞: 10\n- 评论: 1\n- 转发: 0\n- 收藏: 0\n');
    const r = await parseReportMd(tmpPath);
    expect(r.plays).toBe(100n);
    expect(r.completionRateBp).toBeNull();
    expect(r.retention3sBp).toBeNull();
    expect(r.followConversionBp).toBeNull();
    expect(r.topComments).toBeNull();
    await fs.unlink(tmpPath);
  });
});
