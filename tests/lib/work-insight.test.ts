import { describe, it, expect } from 'vitest';
import {
  extractCaptionFeatures,
  buildHypotheses,
  adviseNextVideo,
  CONFIDENT_SAMPLE,
} from '@/lib/works/insight';

const W = (o: Partial<{ caption: string; play: number; durationSec: number; hashtags: string[]; digg: number; collect: number }>) => ({
  id: Math.random().toString(36).slice(2),
  caption: o.caption ?? '',
  play: o.play ?? 0,
  digg: o.digg ?? 0,
  collect: o.collect ?? 0,
  durationSec: o.durationSec ?? 30,
  hashtags: o.hashtags ?? [],
  publishedAt: new Date('2026-06-01'),
});

describe('extractCaptionFeatures', () => {
  it('识别「点明痛点」—— 说清楚替谁解决了什么', () => {
    expect(extractCaptionFeatures('解决了很多用户无法安装无法访问git的痛点').painPoint).toBe(true);
    expect(extractCaptionFeatures('告别配置噩梦，不用装 Python').painPoint).toBe(true);
    expect(extractCaptionFeatures('来聊聊ai未来的生态').painPoint).toBe(false);
  });

  it('识别数字与提问', () => {
    const f = extractCaptionFeatures('6小时用ai赚到100万？');
    expect(f.hasNumber).toBe(true);
    expect(f.hasQuestion).toBe(true);
  });

  it('统计字数与话题数', () => {
    const f = extractCaptionFeatures('把AI塞进U盘', ['ai', 'ai工具']);
    expect(f.captionChars).toBeGreaterThan(5);
    expect(f.hashtagCount).toBe(2);
  });

  it('空文案不报错, 所有特征都是 false/0', () => {
    const f = extractCaptionFeatures('');
    expect(f.painPoint).toBe(false);
    expect(f.captionChars).toBe(0);
  });
});

describe('buildHypotheses', () => {
  const works = [
    W({ caption: '解决了无法安装的痛点', play: 25096, durationSec: 10 }),
    W({ caption: '来聊聊ai未来的生态', play: 411, durationSec: 13 }),
    W({ caption: '当我把龙虾装到u盘是一种什么体验', play: 389, durationSec: 66 }),
    W({ caption: '6小时用ai赚到100万？', play: 393, durationSec: 155 }),
  ];

  it('对每个特征给出「有/没有」两组的播放中位数', () => {
    const h = buildHypotheses(works).find((x) => x.key === 'painPoint')!;
    expect(h.withCount).toBe(1);
    expect(h.withoutCount).toBe(3);
    expect(h.withMedian).toBe(25096);
    expect(h.withoutMedian).toBe(393);
  });

  it('样本不足时置信度必须是 low —— 4 条推不出规律', () => {
    for (const h of buildHypotheses(works)) expect(h.confidence).toBe('low');
  });

  it(`样本达到 ${CONFIDENT_SAMPLE} 条且两组都够时才可能升到 medium`, () => {
    const many = Array.from({ length: CONFIDENT_SAMPLE }, (_, i) =>
      W({ caption: i % 2 === 0 ? '解决了痛点' : '随便聊聊', play: i % 2 === 0 ? 1000 : 100 }),
    );
    expect(buildHypotheses(many).find((h) => h.key === 'painPoint')!.confidence).not.toBe('low');
  });

  it('某一组一条都没有时不出这条假设 —— 没有对照就没有比较', () => {
    const allPain = [W({ caption: '解决了痛点A', play: 100 }), W({ caption: '解决了痛点B', play: 200 })];
    expect(buildHypotheses(allPain).some((h) => h.key === 'painPoint')).toBe(false);
  });

  it('按两组差距排序 —— 差距最大的假设最值得先验证', () => {
    const hs = buildHypotheses(works);
    for (let i = 1; i < hs.length; i++) expect(hs[i - 1].lift).toBeGreaterThanOrEqual(hs[i].lift);
  });

  it('作品少于 2 条时返回空 —— 一条数据不构成比较', () => {
    expect(buildHypotheses([works[0]])).toEqual([]);
  });
});

describe('adviseNextVideo', () => {
  const works = [
    W({ caption: '解决了无法安装的痛点', play: 25096, durationSec: 10 }),
    W({ caption: '来聊聊ai未来的生态', play: 411, durationSec: 13 }),
    W({ caption: '当我把龙虾装到u盘是一种什么体验', play: 389, durationSec: 66 }),
    W({ caption: '6小时用ai赚到100万？', play: 393, durationSec: 155 }),
  ];

  it('给出下一条该试什么, 并说明依据是哪几条作品', () => {
    const a = adviseNextVideo(works);
    expect(a.suggestions.length).toBeGreaterThan(0);
    expect(a.basedOn).toBe(4);
  });

  it('每条建议都带置信度, 不给不带标注的断言', () => {
    for (const s of adviseNextVideo(works).suggestions) {
      expect(['low', 'medium', 'high']).toContain(s.confidence);
    }
  });

  it('样本不足时开头就说清楚这是假设不是结论', () => {
    expect(adviseNextVideo(works).caveat).toContain('假设');
  });

  it('没有作品时不硬给建议', () => {
    const a = adviseNextVideo([]);
    expect(a.suggestions).toEqual([]);
    expect(a.caveat).toContain('还没有');
  });

  it('给出建议时长区间 —— 取表现最好那条的量级, 而不是平均', () => {
    const a = adviseNextVideo(works);
    expect(a.bestDurationSec).toBe(10);
  });
});
