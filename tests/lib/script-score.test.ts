import { describe, it, expect } from 'vitest';
import { scoreHardDimensions, HARD_MAX } from '@/lib/cockpit/script-score';

/** 造一个六幕稿骨架, 只覆盖测试关心的字段。 */
function acts(overrides: Partial<Record<string, { narration?: string; visual?: string }>> = {}) {
  const keys = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'];
  return keys.map((act) => ({
    act,
    title: act,
    narration: overrides[act]?.narration ?? '这是一句干净的台词。',
    visual: overrides[act]?.visual ?? '出镜正面',
    note: '',
    targetSec: 10,
    beats: [],
    facts: [],
  }));
}

function dim(result: ReturnType<typeof scoreHardDimensions>, key: string) {
  const d = result.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`没有这个维度: ${key}`);
  return d;
}

describe('scoreHardDimensions', () => {
  it('总分等于各维度之和, 满分 35', () => {
    const r = scoreHardDimensions(acts());
    expect(r.total).toBe(r.dimensions.reduce((s, d) => s + d.score, 0));
    expect(r.max).toBe(HARD_MAX);
    expect(r.max).toBe(35);
  });

  describe('信任声明', () => {
    it('前两幕出现「不卖课」给满分', () => {
      const r = scoreHardDimensions(acts({ hook: { narration: '先说清楚，我不卖课不收徒。' } }));
      expect(dim(r, 'trust').score).toBe(10);
    });

    it('声明放到末幕只给一半 —— 防喷要趁早', () => {
      const r = scoreHardDimensions(acts({ punchline: { narration: '顺带一提我不带货。' } }));
      expect(dim(r, 'trust').score).toBe(5);
    });

    it('完全没有声明给 0 分', () => {
      const r = scoreHardDimensions(acts());
      expect(dim(r, 'trust').score).toBe(0);
      expect(dim(r, 'trust').reason).toContain('没有');
    });
  });

  describe('平台合规', () => {
    it('画面说明里要放后台收款截图 —— 扣光', () => {
      const r = scoreHardDimensions(acts({ synthesis: { visual: '切到后台收款截图，展示当月流水' } }));
      expect(dim(r, 'compliance').score).toBe(0);
      expect(dim(r, 'compliance').reason).toContain('synthesis');
    });

    it('明确写了「不出现后台截图」的不算违规 —— 否定句豁免', () => {
      const r = scoreHardDimensions(
        acts({ synthesis: { visual: '出镜正面。全片不出现任何后台、收款、订单截图。' } }),
      );
      expect(dim(r, 'compliance').score).toBe(5);
    });

    it('同一句里既有否定也有别的分句违规时, 只看违规那句', () => {
      const r = scoreHardDimensions(
        acts({ synthesis: { visual: '不放订单截图，但可以放一下后台流水截图' } }),
      );
      expect(dim(r, 'compliance').score).toBe(0);
    });
  });

  describe('普适化结尾', () => {
    it('末幕有扩圈句给满分', () => {
      const r = scoreHardDimensions(acts({ punchline: { narration: '你做电商、做服务，也是一样的。' } }));
      expect(dim(r, 'universal').score).toBe(5);
    });

    it('扩圈句出现在中间幕不算 —— 结尾才有扩圈作用', () => {
      const r = scoreHardDimensions(acts({ trivia: { narration: '你做电商也是一样的。' } }));
      expect(dim(r, 'universal').score).toBe(0);
    });
  });

  describe('简洁度', () => {
    it('干净短句给满分', () => {
      const r = scoreHardDimensions(acts());
      expect(dim(r, 'concise').score).toBe(15);
    });

    it('每个垫话词扣分, 并在理由里点名', () => {
      const clean = scoreHardDimensions(acts()).dimensions.find((d) => d.key === 'concise')!.score;
      const r = scoreHardDimensions(acts({ hook: { narration: '说实话，这东西居然卖爆了。' } }));
      expect(dim(r, 'concise').score).toBeLessThan(clean);
      expect(dim(r, 'concise').reason).toContain('说实话');
      expect(dim(r, 'concise').reason).toContain('居然');
    });

    it('垫话再多也不会扣成负分', () => {
      const filler = '说实话其实居然毫无意义地毫无意外，坦白讲，不得不说，众所周知。';
      const r = scoreHardDimensions(
        acts({ hook: { narration: filler }, concept_a: { narration: filler }, trivia: { narration: filler } }),
      );
      expect(dim(r, 'concise').score).toBe(0);
    });

    it('「的话题」不算垫话「的话」—— 中文没有词边界, 裸子串匹配会误伤', () => {
      const r = scoreHardDimensions(acts({ concept_a: { narration: '养小龙虾的话题火了。' } }));
      expect(dim(r, 'concise').score).toBe(15);
    });

    it('逗号分隔的长句不算长 —— 口播的换气点是逗号, 不是句号', () => {
      const r = scoreHardDimensions(
        acts({
          hook: {
            narration:
              '今年很火的那个开源项目，我靠给别人安装它，赚到了做互联网生意的第一笔钱，后来还复刻了好几次。',
          },
        }),
      );
      expect(dim(r, 'concise').score).toBe(15);
    });

    it('句子过长要扣分 —— 口播念不动', () => {
      const long =
        '我在去年那个时候想要尝试着去跑一个在 GitHub 上面看到的开源项目结果发现安装说明写了十几步而我从下午一直搞到半夜也没能跑起来。';
      const r = scoreHardDimensions(acts({ hook: { narration: long } }));
      expect(dim(r, 'concise').score).toBeLessThan(15);
      expect(dim(r, 'concise').reason).toContain('句');
    });
  });
});
