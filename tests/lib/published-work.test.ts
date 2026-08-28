import { describe, it, expect } from 'vitest';
import {
  looksAiRelated,
  BASELINE_YEAR_FROM,
  shouldCountByDefault,
  buildBaseline,
} from '@/lib/works/model';

const W = (title: string, play: number, year = 2026) => ({
  title,
  play,
  publishedAt: new Date(`${year}-06-01T00:00:00Z`),
});

describe('looksAiRelated', () => {
  it('命中 AI / 工具类关键词', () => {
    expect(looksAiRelated('把openclaw打包成一件安装的exe程序了')).toBe(true);
    expect(looksAiRelated('6小时用ai赚到100万？')).toBe(true);
    expect(looksAiRelated('当我把龙虾装到u盘是一种什么体验')).toBe(true);
    expect(looksAiRelated('来聊聊ai未来的生态')).toBe(true);
  });

  it('生活向内容不算', () => {
    expect(looksAiRelated('我曾9次打开新世界的大门。#地球online #游戏人生')).toBe(false);
    expect(looksAiRelated('没染过黄毛的我，今天终于圆梦啦！')).toBe(false);
    expect(looksAiRelated('像风一样自由～')).toBe(false);
  });

  it('空标题不算 —— 判不了就不猜', () => {
    expect(looksAiRelated('')).toBe(false);
    expect(looksAiRelated('   ')).toBe(false);
  });
});

describe('shouldCountByDefault', () => {
  it('2026 年 + AI 相关 → 默认计入', () => {
    expect(shouldCountByDefault(W('把openclaw打包成exe', 25096))).toBe(true);
  });

  it('AI 相关但太早 → 不计入, 那时候账号不是这个方向', () => {
    expect(shouldCountByDefault(W('聊聊ai', 100, 2021))).toBe(false);
  });

  it('2026 年但不是 AI 相关 → 不计入', () => {
    expect(shouldCountByDefault(W('像风一样自由～', 5730))).toBe(false);
  });

  it(`分界年份是导出的常量, 不是散在代码里的 ${BASELINE_YEAR_FROM}`, () => {
    expect(BASELINE_YEAR_FROM).toBe(2026);
  });
});

describe('buildBaseline', () => {
  it('只统计被计入的作品', () => {
    const b = buildBaseline([
      { play: 100, counted: true }, { play: 200, counted: true },
      { play: 300, counted: true }, { play: 99999, counted: false },
    ]);
    expect(b.count).toBe(3);
    expect(b.median).toBe(200);
  });

  it('少于 3 条不给中位数 —— 冷启动时个别极端值会误导(沿用既有口径)', () => {
    const b = buildBaseline([{ play: 100, counted: true }, { play: 25096, counted: true }]);
    expect(b.count).toBe(2);
    expect(b.median).toBeNull();
  });

  it('一条都没计入时不报错', () => {
    const b = buildBaseline([{ play: 100, counted: false }]);
    expect(b.count).toBe(0);
    expect(b.median).toBeNull();
    expect(b.max).toBe(0);
  });

  it('同时给出最高值 —— 中位数说明常态, 最高值说明上限', () => {
    const b = buildBaseline([
      { play: 100, counted: true }, { play: 200, counted: true }, { play: 25096, counted: true },
    ]);
    expect(b.median).toBe(200);
    expect(b.max).toBe(25096);
  });

  it('0 播放的也算进中位数 —— 发出去没人看是真实表现的一部分', () => {
    const b = buildBaseline([
      { play: 0, counted: true }, { play: 0, counted: true }, { play: 300, counted: true },
    ]);
    expect(b.median).toBe(0);
    expect(b.count).toBe(3);
  });
});
