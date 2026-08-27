import { describe, it, expect } from 'vitest';
import { scoreHardDimensions, HARD_MAX, HARD_WEIGHTS } from '@/lib/cockpit/script-score';

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
    const r = scoreHardDimensions(acts(), 60);
    expect(r.total).toBe(r.dimensions.reduce((s, d) => s + d.score, 0));
    expect(r.max).toBe(HARD_MAX);
    expect(r.max).toBe(35);
  });

  describe('信任声明', () => {
    it('前两幕出现「不卖课」给满分', () => {
      const r = scoreHardDimensions(acts({ hook: { narration: '先说清楚，我不卖课不收徒。' } }), 60);
      expect(dim(r, 'trust').score).toBe(HARD_WEIGHTS.trust);
    });

    it('声明放到末幕只给一半 —— 防喷要趁早', () => {
      const r = scoreHardDimensions(acts({ punchline: { narration: '顺带一提我不带货。' } }), 60);
      expect(dim(r, 'trust').score).toBe(HARD_WEIGHTS.trust / 2);
    });

    it('完全没有声明给 0 分', () => {
      const r = scoreHardDimensions(acts(), 60);
      expect(dim(r, 'trust').score).toBe(0);
      expect(dim(r, 'trust').reason).toContain('没有');
    });
  });

  describe('平台合规', () => {
    it('画面说明里要放后台收款截图 —— 扣光', () => {
      const r = scoreHardDimensions(acts({ synthesis: { visual: '切到后台收款截图，展示当月流水' } }), 60);
      expect(dim(r, 'compliance').score).toBe(0);
      expect(dim(r, 'compliance').reason).toContain('synthesis');
    });

    it('明确写了「不出现后台截图」的不算违规 —— 否定句豁免', () => {
      const r = scoreHardDimensions(
        acts({ synthesis: { visual: '出镜正面。全片不出现任何后台、收款、订单截图。' } }),
        60,
      );
      expect(dim(r, 'compliance').score).toBe(HARD_WEIGHTS.compliance);
    });

    it('同一句里既有否定也有别的分句违规时, 只看违规那句', () => {
      const r = scoreHardDimensions(
        acts({ synthesis: { visual: '不放订单截图，但可以放一下后台流水截图' } }),
        60,
      );
      expect(dim(r, 'compliance').score).toBe(0);
    });
  });

  describe('普适化结尾', () => {
    it('末幕有扩圈句给满分', () => {
      const r = scoreHardDimensions(acts({ punchline: { narration: '你做电商、做服务，也是一样的。' } }), 60);
      expect(dim(r, 'universal').score).toBe(HARD_WEIGHTS.universal);
    });

    it('扩圈句出现在中间幕不算 —— 结尾才有扩圈作用', () => {
      const r = scoreHardDimensions(acts({ trivia: { narration: '你做电商也是一样的。' } }), 60);
      expect(dim(r, 'universal').score).toBe(0);
    });
  });

  describe('简洁度', () => {
    it('干净短句给满分', () => {
      const r = scoreHardDimensions(acts(), 60);
      expect(dim(r, 'concise').score).toBe(HARD_WEIGHTS.concise);
    });

    it('每个垫话词扣分, 并在理由里点名', () => {
      const clean = scoreHardDimensions(acts(), 60).dimensions.find((d) => d.key === 'concise')!.score;
      const r = scoreHardDimensions(acts({ hook: { narration: '说实话，这东西居然卖爆了。' } }), 60);
      expect(dim(r, 'concise').score).toBeLessThan(clean);
      expect(dim(r, 'concise').reason).toContain('说实话');
      expect(dim(r, 'concise').reason).toContain('居然');
    });

    it('垫话再多也不会扣成负分', () => {
      const filler = '说实话其实居然毫无意义地毫无意外，坦白讲，不得不说，众所周知。';
      const r = scoreHardDimensions(
        acts({ hook: { narration: filler }, concept_a: { narration: filler }, trivia: { narration: filler } }),
        60,
      );
      expect(dim(r, 'concise').score).toBe(0);
    });

    it('「的话题」不算垫话「的话」—— 中文没有词边界, 裸子串匹配会误伤', () => {
      const r = scoreHardDimensions(acts({ concept_a: { narration: '养小龙虾的话题火了。' } }), 60);
      expect(dim(r, 'concise').score).toBe(HARD_WEIGHTS.concise);
    });

    it('逗号分隔的长句不算长 —— 口播的换气点是逗号, 不是句号', () => {
      const r = scoreHardDimensions(
        acts({
          hook: {
            narration:
              '今年很火的那个开源项目，我靠给别人安装它，赚到了做互联网生意的第一笔钱，后来还复刻了好几次。',
          },
        }),
        60,
      );
      expect(dim(r, 'concise').score).toBe(HARD_WEIGHTS.concise);
    });

    it('句子过长要扣分 —— 口播念不动', () => {
      const long =
        '我在去年那个时候想要尝试着去跑一个在 GitHub 上面看到的开源项目结果发现安装说明写了十几步而我从下午一直搞到半夜也没能跑起来。';
      const r = scoreHardDimensions(acts({ hook: { narration: long } }), 60);
      expect(dim(r, 'concise').score).toBeLessThan(HARD_WEIGHTS.concise);
      expect(dim(r, 'concise').reason).toContain('句');
    });
  });

  describe('时长偏差（设计稿引入）', () => {
    it('每幕都贴着目标 → 满分', () => {
      // 六幕各 10 秒、全片 60 秒时结构占比并不均匀, 用真实占比造一份贴合的稿子
      const fitted = [
        { act: 'hook', targetSec: 6 },
        { act: 'concept_a', targetSec: 13.5 },
        { act: 'concept_b', targetSec: 13.5 },
        { act: 'trivia', targetSec: 9 },
        { act: 'synthesis', targetSec: 13.5 },
        { act: 'punchline', targetSec: 4.5 },
      ].map((x) => ({ ...x, title: x.act, narration: '干净台词。', visual: '出镜正面', note: '', beats: [], facts: [] }));
      const r = scoreHardDimensions(fitted, 60);
      expect(dim(r, 'duration').score).toBe(HARD_WEIGHTS.duration);
    });

    it('某一幕严重超时 → 扣分并在理由里点名是哪一幕', () => {
      const r = scoreHardDimensions(acts({}), 30); // 六幕各 10 秒但全片只有 30 秒
      expect(dim(r, 'duration').score).toBeLessThan(HARD_WEIGHTS.duration);
      expect(dim(r, 'duration').reason).toMatch(/超/);
    });

    it('合计超时额外扣 —— 单幕都没超但加起来超了也要提示', () => {
      const r = scoreHardDimensions(acts(), 50);
      expect(dim(r, 'duration').reason).toContain('合计');
    });

    it('全片时长为 0 时不除零, 也不误判成满分', () => {
      const r = scoreHardDimensions(acts(), 0);
      expect(Number.isFinite(dim(r, 'duration').score)).toBe(true);
    });
  });

  describe('幕结构完整（设计稿引入）', () => {
    it('六幕齐全且每幕有旁白/画面/关键词 → 满分', () => {
      const full = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'].map((act) => ({
        act, title: act, narration: '干净台词。', visual: '出镜正面', note: '',
        targetSec: 10, beats: [{ keyword: 'k' }], facts: [],
      }));
      expect(dim(scoreHardDimensions(full, 60), 'structure').score).toBe(HARD_WEIGHTS.structure);
    });

    it('缺幕要扣分并点名', () => {
      const missing = acts().filter((a) => a.act !== 'trivia').map((a) => ({ ...a, beats: [{ keyword: 'k' }] }));
      const r = scoreHardDimensions(missing, 60);
      expect(dim(r, 'structure').score).toBeLessThan(HARD_WEIGHTS.structure);
      expect(dim(r, 'structure').reason).toContain('冷知识');
    });

    it('关键词密度并入这一项 —— 没有关键词的幕要扣分', () => {
      const noBeats = acts(); // 造数据函数里 beats 为空
      const r = scoreHardDimensions(noBeats, 60);
      expect(dim(r, 'structure').score).toBeLessThan(HARD_WEIGHTS.structure);
      expect(dim(r, 'structure').reason).toContain('关键词');
    });
  });

  it('六个维度的权重加起来正好 35', () => {
    const sum = Object.values(HARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(35);
    expect(sum).toBe(HARD_MAX);
  });

  it('权重可覆盖 —— 慢回路重拟合之后要能改, 不能写死', () => {
    const r = scoreHardDimensions(acts(), 60, { ...HARD_WEIGHTS, concise: 20 });
    expect(dim(r, 'concise').max).toBe(20);
  });
});
