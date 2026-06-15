import { describe, expect, it } from 'vitest';
import { parseListOutput } from '@/lib/douyin/list';

describe('parseListOutput', () => {
  it('标准 3 行 → 3 items', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放8.5w  ChatGPT 5 个技巧
[1] 7234567890123456788  2026-06-09 12:15  播放3.2k  AI 工具排行
[2] 7234567890123456787  2026-06-08 09:00  播放123  hello world`;
    const items = parseListOutput(stdout);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      awemeId: '7234567890123456789',
      postedAt: '2026-06-10 14:30',
      plays: '8.5w',
      desc: 'ChatGPT 5 个技巧',
    });
    expect(items[2].plays).toBe('123');
  });

  it('空输出 → []', () => {
    expect(parseListOutput('')).toEqual([]);
  });

  it('异常行 (无 "播放" 字段) 跳过', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  desc-good
some random log line
[1] BROKEN no time field
[2] 7234567890123456788  2026-06-09 12:15  播放200  desc-good-2`;
    const items = parseListOutput(stdout);
    expect(items).toHaveLength(2);
    expect(items[0].awemeId).toBe('7234567890123456789');
    expect(items[1].awemeId).toBe('7234567890123456788');
  });

  it('desc 含 | 和 中文标点 保留', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放8.5w  视频 | 副标题: 你好,世界。`;
    const items = parseListOutput(stdout);
    expect(items[0].desc).toBe('视频 | 副标题: 你好,世界。');
  });

  it('aweme_id 19 位数字 (典型抖音长度)', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  x`;
    expect(parseListOutput(stdout)[0].awemeId).toBe('7234567890123456789');
  });

  it('desc 末尾空白被 trim', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  hello   \n`;
    expect(parseListOutput(stdout)[0].desc).toBe('hello');
  });
});
