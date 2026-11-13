import { describe, expect, it } from 'vitest';
import { clusterRows, hiddenByDefault, isThin, pickHome, titlesSimilar, whyLine, HOME_PICKS, SCORE_FLOOR } from '@/lib/overview/cluster';
import type { FeedRow } from '@/lib/overview/feed';
import type { HotScore, ScorePart } from '@/lib/overview/hot-score';

const part = (key: ScorePart['key'], value: number, detail: string): ScorePart => ({ key, label: key, value, weight: 0.25, applied: 0.25, detail });

const score = (total: number, fit = 0, fitDetail = '标题和简介都没碰到。'): HotScore => ({
  total,
  parts: [part('heat', 80, '热度'), part('recency', 90, '新旧'), part('fit', fit, fitDetail), part('handsOn', 0, '不是仓库')],
});

const row = (over: Partial<FeedRow> & Pick<FeedRow, 'key' | 'title'>): FeedRow => ({
  kind: 'source',
  refId: over.key,
  dailyId: null,
  provider: 'x',
  sourceLabel: 'X',
  why: null,
  url: null,
  heat: 100,
  heatLabel: '100 浏览',
  seenAt: '2026-11-13',
  seenLabel: '今天',
  statusKey: 'fresh',
  status: '还没写',
  fit: '抖音口播',
  score: score(70),
  canAdopt: false,
  ...over,
});

describe('clusterRows', () => {
  it('merges the same GitHub repo across a repo row and a post that names it', () => {
    const clusters = clusterRows([
      row({ key: 'gh', title: 'wangzan101/Mika', provider: 'github', sourceLabel: 'GitHub', url: 'https://github.com/wangzan101/Mika', why: 'An on-device AI agent.', score: score(90, 100, '命中AI、工具。'), heatLabel: '8,476 stars' }),
      row({ key: 'x1', title: '给 Agent-Autoloop 做完了 Windows 兼容', why: '仓库在 https://github.com/wangzan101/Mika', score: score(80, 60, '命中AI。') }),
      row({ key: 'other', title: '求推荐适合男生的香水', score: score(77) }),
    ]);
    const mika = clusters.find((cluster) => cluster.lead.key === 'gh' || cluster.related.some((item) => item.key === 'gh'));
    expect(mika?.related.map((item) => item.key).concat(mika.lead.key).sort()).toEqual(['gh', 'x1']);
    expect(clusters.find((cluster) => cluster.lead.key === 'other')?.related).toEqual([]);
  });

  it('merges posts that share a versioned product name', () => {
    const clusters = clusterRows([
      row({ key: 'a', title: 'Claude Fable 5.2 的视频能力又进化了', score: score(88, 60, '命中AI。') }),
      row({ key: 'b', title: '让 Fable 5.2 重新设计了客户端', score: score(80, 60, '命中AI。') }),
      row({ key: 'c', title: '开源紫微斗数破一万星', score: score(81, 60, '命中工具。') }),
    ]);
    const fable = clusters.find((cluster) => cluster.related.length > 0);
    expect(fable?.related).toHaveLength(1);
    expect(titlesSimilar('Hugging Face CEO vows to keep fighting', 'Nvidia CEO resigns')).toBe(false);
  });

  it('merges near-duplicate Chinese titles without chaining unrelated posts', () => {
    expect(titlesSimilar('深扒了《持械入宋》，我自己看了 6 季', '深扒《持械入宋》成功绝非偶然')).toBe(true);
    const clusters = clusterRows([
      row({ key: 'a', title: '深扒了《持械入宋》，我自己看了 6 季', score: score(80, 60, '命中AI。') }),
      row({ key: 'b', title: '深扒《持械入宋》成功绝非偶然', score: score(70, 60, '命中AI。') }),
      row({ key: 'c', title: '灰度路由到了新模型，审美很强', score: score(75, 60, '命中AI。') }),
    ]);
    expect(clusters.find((cluster) => cluster.lead.key === 'a')?.related.map((item) => item.key)).toEqual(['b']);
    expect(clusters.find((cluster) => cluster.lead.key === 'c')?.related).toEqual([]);
  });
});

describe('pickHome', () => {
  it('keeps ten picks and spreads them across sources', () => {
    const providers = ['x', 'github', 'hackernews', 'reddit'] as const;
    const clusters = providers.flatMap((provider, p) =>
      Array.from({ length: 8 }, (_, i) => ({
        id: `${provider}${i}`,
        lead: row({ key: `${provider}${i}`, title: `${provider} ${i}`, provider, sourceLabel: provider, score: score(95 - p * 3 - i) }),
        related: [],
      })),
    );
    const picks = pickHome(clusters);
    expect(picks).toHaveLength(HOME_PICKS);
    for (const provider of providers) expect(picks.some((cluster) => cluster.lead.provider === provider)).toBe(true);
    for (const provider of providers) {
      expect(picks.filter((cluster) => cluster.lead.provider === provider).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('why and noise', () => {
  it('uses the repo description when it is not the title, and heat plus track when the post repeats itself', () => {
    const repo = row({
      key: 'gh',
      title: 'D4Vinci/Scrapling',
      provider: 'github',
      sourceLabel: 'GitHub',
      why: '抓网页的库，自适应选择器。',
      heatLabel: '101,876 stars',
      score: score(84, 60, '命中工具。'),
    });
    expect(whyLine(repo)).toBe('101,876 stars · 抓网页的库，自适应选择器。');
    const post = row({
      key: 'x',
      title: '终于出差完回家了，打开了电脑',
      why: '终于出差完回家了，打开了电脑，花了一点时间。',
      heatLabel: '79,845 浏览',
      score: score(87, 60, '命中AI、工具。'),
    });
    expect(whyLine(post)).toBe('79,845 浏览 · 碰到AI、工具');
  });

  it('hides low scores and X posts that miss the track or are tiny', () => {
    const thin = row({ key: 'thin', title: '求推荐香水，味道干净一点', score: score(77, 0) });
    const short = row({ key: 'short', title: '上线了', why: '上线了', score: score(80, 100, '命中AI。') });
    const kept = row({ key: 'kept', title: 'Claude Fable 5.2 的视频节奏和动效又强了一截，值得拆开讲', score: score(80, 60, '命中AI。') });
    const low = row({ key: 'low', title: '一个小仓库', provider: 'github', score: score(SCORE_FLOOR - 1, 60, '命中工具。') });
    expect(isThin(thin)).toBe(true);
    expect(isThin(short)).toBe(true);
    expect(isThin(kept)).toBe(false);
    expect(hiddenByDefault(low)).toBe(true);
    expect(hiddenByDefault(kept)).toBe(false);
  });
});
