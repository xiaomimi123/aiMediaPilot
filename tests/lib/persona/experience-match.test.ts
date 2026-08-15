import { describe, expect, it } from 'vitest';
import { matchExperiences } from '@/lib/persona/experience-match';
import type { ExperienceItem } from '@/lib/persona/voice';

function item(over: Partial<ExperienceItem> & { id: string }): ExperienceItem {
  return {
    content: '默认内容',
    topic: '',
    kind: '',
    keywords: [],
    usedCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('matchExperiences', () => {
  it('空库 / 空主题 / limit<=0 一律返回 []', () => {
    const items = [item({ id: 'a', keywords: ['AI'] })];
    expect(matchExperiences('AI', [], 3)).toEqual([]);
    expect(matchExperiences('', items, 3)).toEqual([]);
    expect(matchExperiences('   ', items, 3)).toEqual([]);
    expect(matchExperiences('AI', items, 0)).toEqual([]);
  });

  it('命中数为 0 的条目被排除 —— 宁可不给也不给不相关的', () => {
    const items = [
      item({ id: 'unrelated', keywords: ['做饭', '菜谱'], topic: '厨艺' }),
      item({ id: 'hit', keywords: ['提示词'], topic: 'AI 写作' }),
    ];
    const got = matchExperiences('提示词怎么写', items, 3);
    expect(got.map((i) => i.id)).toEqual(['hit']);
  });

  it('按命中数降序排序', () => {
    const items = [
      item({ id: 'one', keywords: ['效率'], topic: '' }),
      item({ id: 'two', keywords: ['效率', '工具'], topic: '' }),
    ];
    const got = matchExperiences('效率 工具', items, 3);
    expect(got.map((i) => i.id)).toEqual(['two', 'one']);
  });

  it('同命中数时按新鲜度(createdAt)降序', () => {
    const items = [
      item({ id: 'old', keywords: ['效率'], createdAt: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'new', keywords: ['效率'], createdAt: '2026-08-10T00:00:00.000Z' }),
    ];
    const got = matchExperiences('效率', items, 3);
    expect(got.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('limit 截断', () => {
    const items = [
      item({ id: 'a', keywords: ['AI'], createdAt: '2026-08-03T00:00:00.000Z' }),
      item({ id: 'b', keywords: ['AI'], createdAt: '2026-08-02T00:00:00.000Z' }),
      item({ id: 'c', keywords: ['AI'], createdAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(matchExperiences('AI', items, 2).map((i) => i.id)).toEqual(['a', 'b']);
    expect(matchExperiences('AI', items).map((i) => i.id)).toEqual(['a', 'b', 'c']); // 默认 limit=3
  });

  it('大小写与前后空白不敏感', () => {
    const items = [item({ id: 'a', keywords: ['  DeepSeek  '] })];
    expect(matchExperiences('deepseek 实测', items, 3).map((i) => i.id)).toEqual(['a']);
  });

  it('topic 字段也参与匹配, 不只看 keywords', () => {
    const items = [item({ id: 'a', keywords: [], topic: '副业' })];
    expect(matchExperiences('副业', items, 3).map((i) => i.id)).toEqual(['a']);
  });

  it('双向包含: 中文粒度不一致时仍能命中 (主题串包含条目词)', () => {
    const items = [item({ id: 'a', keywords: ['翻车'] })];
    expect(matchExperiences('用AI写文案翻车了', items, 3).map((i) => i.id)).toEqual(['a']);
  });

  it('条目无任何可匹配词时不命中', () => {
    const items = [item({ id: 'a', keywords: [], topic: '' })];
    expect(matchExperiences('任何主题', items, 3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 十二期 T6 真实 E2E 驱动的回归 —— 这两条在收尾走查里真实复现过, 曾让整个经历库形同虚设
// ---------------------------------------------------------------------------
describe('中文不分词场景 (真实数据回归)', () => {
  it('关键词不是主题子串但语义相关时仍命中 (2 字滑窗)', () => {
    const items = [
      item({ id: 'real1', topic: '提问能力', keywords: ['AI使用心得', '提问技巧', '思考方式'] }),
      item({
        id: 'real2',
        topic: '学AI改变思维',
        keywords: ['学AI', '效率提升', '思维方式', '非技术背景'],
        createdAt: '2026-08-16T00:00:01.000Z',
      }),
    ];
    // E2E 真实主题: 关键词「提问技巧」不是它的子串, 旧的纯 includes 匹配在这里 0 命中
    const got = matchExperiences('为什么很多人用AI效率没提升——你可能一直在用错的方式提问', items, 3);
    expect(got.length).toBeGreaterThan(0);
  });

  it('主题确实无关时仍然不命中(滑窗没有放宽到乱匹配)', () => {
    const items = [item({ id: 'a', keywords: ['提问技巧', '思考方式'] })];
    expect(matchExperiences('如何挑选一台家用咖啡机', items, 3)).toEqual([]);
  });
});

describe('ASCII 词走词边界而非子串 (真实误伤回归)', () => {
  it('「AI」不该命中 detail / maintain 这类含 ai 的英文词', () => {
    const items = [item({ id: 'a', keywords: ['AI'] })];
    expect(matchExperiences('detail maintain', items, 3)).toEqual([]);
  });

  it('中英混排主题里的 AI 仍能命中(中文字符不构成单词字符, 词边界成立)', () => {
    const items = [item({ id: 'a', keywords: ['AI'] })];
    expect(matchExperiences('很多人用AI效率没提升', items, 3).map((i) => i.id)).toEqual(['a']);
  });

  it('工具名大小写不敏感', () => {
    const items = [item({ id: 'a', keywords: ['Claude'] })];
    expect(matchExperiences('用 claude 写小红书文案', items, 3).map((i) => i.id)).toEqual(['a']);
  });
});
