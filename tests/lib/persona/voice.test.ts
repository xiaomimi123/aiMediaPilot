import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreatorVoiceSchema,
  EXPERIENCE_KIND_LABELS,
  isVoiceEstablished,
  loadCreatorVoice,
  loadExperiences,
  parseExperienceKeywords,
  parseVoiceStances,
  validateExperienceKind,
  type CreatorVoiceData,
} from '@/lib/persona/voice';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    creatorVoice: { findUnique: vi.fn() },
    creatorExperience: { findMany: vi.fn() },
  },
}));

const { prisma } = await import('@/lib/prisma');

function voice(over: Partial<CreatorVoiceData> = {}): CreatorVoiceData {
  return { origin: '', identity: '', notIdentity: '', stances: [], energy: '', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreatorVoiceSchema 边界', () => {
  const base = { origin: '', identity: '', notIdentity: '', stances: [], energy: '' };

  it('空档案合法(全部字段可选)', () => {
    expect(CreatorVoiceSchema.safeParse(base).success).toBe(true);
  });

  it('origin 500 过 / 501 拒', () => {
    expect(CreatorVoiceSchema.safeParse({ ...base, origin: 'a'.repeat(500) }).success).toBe(true);
    expect(CreatorVoiceSchema.safeParse({ ...base, origin: 'a'.repeat(501) }).success).toBe(false);
  });

  it('identity / notIdentity / energy 200 过 / 201 拒', () => {
    for (const key of ['identity', 'notIdentity', 'energy'] as const) {
      expect(CreatorVoiceSchema.safeParse({ ...base, [key]: 'a'.repeat(200) }).success).toBe(true);
      expect(CreatorVoiceSchema.safeParse({ ...base, [key]: 'a'.repeat(201) }).success).toBe(false);
    }
  });

  it('stances 5 条过 / 6 条拒; claim 50 过 / 51 拒; claim 空拒', () => {
    const s = (n: number) => Array.from({ length: n }, () => ({ claim: 'x', reason: 'y' }));
    expect(CreatorVoiceSchema.safeParse({ ...base, stances: s(5) }).success).toBe(true);
    expect(CreatorVoiceSchema.safeParse({ ...base, stances: s(6) }).success).toBe(false);
    expect(
      CreatorVoiceSchema.safeParse({ ...base, stances: [{ claim: 'a'.repeat(50), reason: '' }] })
        .success,
    ).toBe(true);
    expect(
      CreatorVoiceSchema.safeParse({ ...base, stances: [{ claim: 'a'.repeat(51), reason: '' }] })
        .success,
    ).toBe(false);
    expect(
      CreatorVoiceSchema.safeParse({ ...base, stances: [{ claim: '', reason: '' }] }).success,
    ).toBe(false);
  });

  it('reason 100 过 / 101 拒', () => {
    expect(
      CreatorVoiceSchema.safeParse({ ...base, stances: [{ claim: 'a', reason: 'b'.repeat(100) }] })
        .success,
    ).toBe(true);
    expect(
      CreatorVoiceSchema.safeParse({ ...base, stances: [{ claim: 'a', reason: 'b'.repeat(101) }] })
        .success,
    ).toBe(false);
  });
});

describe('isVoiceEstablished —— 只看 identity', () => {
  it('identity 非空即已建立, 其余字段全空也算', () => {
    expect(isVoiceEstablished(voice({ identity: '一个用 AI 提高认知的普通人' }))).toBe(true);
  });

  it('identity 空 / 纯空白 → 未建立', () => {
    expect(isVoiceEstablished(voice())).toBe(false);
    expect(isVoiceEstablished(voice({ identity: '   ' }))).toBe(false);
  });

  it('其余字段填满但 identity 空 → 仍未建立', () => {
    expect(
      isVoiceEstablished(
        voice({ origin: '很长的故事', stances: [{ claim: 'a', reason: 'b' }], energy: '自信' }),
      ),
    ).toBe(false);
  });
});

describe('parseVoiceStances 防御解析', () => {
  it('非数组 → []', () => {
    expect(parseVoiceStances(null)).toEqual([]);
    expect(parseVoiceStances('x')).toEqual([]);
    expect(parseVoiceStances({ claim: 'a' })).toEqual([]);
  });

  it('缺 claim / claim 非字符串 / claim 空串 → 整条丢弃', () => {
    expect(
      parseVoiceStances([{ reason: 'r' }, { claim: 1, reason: 'r' }, { claim: '', reason: 'r' }]),
    ).toEqual([]);
  });

  it('reason 缺失或非字符串 → 兜底空串, 不丢整条', () => {
    expect(parseVoiceStances([{ claim: 'a' }, { claim: 'b', reason: 2 }])).toEqual([
      { claim: 'a', reason: '' },
      { claim: 'b', reason: '' },
    ]);
  });
});

describe('validateExperienceKind 宽进严出', () => {
  it('四个合法值原样返回', () => {
    for (const k of ['practice', 'failure', 'insight', 'result']) {
      expect(validateExperienceKind(k)).toBe(k);
    }
  });

  it('非法值一律 ""', () => {
    expect(validateExperienceKind('Practice')).toBe(''); // 大小写不同
    expect(validateExperienceKind(' practice')).toBe(''); // 带空白
    expect(validateExperienceKind('unknown')).toBe('');
    expect(validateExperienceKind(null)).toBe('');
    expect(validateExperienceKind(undefined)).toBe('');
    expect(validateExperienceKind(3)).toBe('');
  });

  it('每个合法 kind 都有中文标签', () => {
    expect(Object.keys(EXPERIENCE_KIND_LABELS).sort()).toEqual(
      ['failure', 'insight', 'practice', 'result'].sort(),
    );
  });
});

describe('parseExperienceKeywords 防御解析', () => {
  it('非数组 → []; 非字符串/空白条目丢弃', () => {
    expect(parseExperienceKeywords(null)).toEqual([]);
    expect(parseExperienceKeywords(['a', 1, '', '  ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('loadCreatorVoice', () => {
  it('无行 → null', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue(null as never);
    expect(await loadCreatorVoice('u1')).toBeNull();
  });

  it('有行但 identity 空(未建立) → null', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue({
      userId: 'u1',
      origin: '有故事',
      identity: '',
      notIdentity: '',
      stances: [],
      energy: '',
      updatedAt: new Date(),
    } as never);
    expect(await loadCreatorVoice('u1')).toBeNull();
  });

  it('已建立 → 返回数据, stances 走防御解析', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue({
      userId: 'u1',
      origin: '来路',
      identity: '一个普通人',
      notIdentity: '不是极客',
      stances: [{ claim: '我认为提示词工程是伪需求', reason: '因为模型在进步' }, { bad: 1 }],
      energy: '自信、有感染力',
      updatedAt: new Date(),
    } as never);
    const got = await loadCreatorVoice('u1');
    expect(got?.identity).toBe('一个普通人');
    expect(got?.notIdentity).toBe('不是极客');
    expect(got?.stances).toEqual([
      { claim: '我认为提示词工程是伪需求', reason: '因为模型在进步' },
    ]); // 畸形条目被丢弃
  });
});

describe('loadExperiences', () => {
  it('映射字段并防御解析 keywords/kind; createdAt 转 ISO', async () => {
    vi.mocked(prisma.creatorExperience.findMany).mockResolvedValue([
      {
        id: 'e1',
        userId: 'u1',
        content: '今天用 X 工具翻车了',
        topic: 'AI 工具',
        kind: 'failure',
        keywords: ['翻车', 1, ''],
        usedCount: 2,
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
      },
      {
        id: 'e2',
        userId: 'u1',
        content: '打标签失败的条目',
        topic: '',
        kind: 'WEIRD',
        keywords: 'not-array',
        usedCount: 0,
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    ] as never);
    const got = await loadExperiences('u1');
    expect(got[0]).toEqual({
      id: 'e1',
      content: '今天用 X 工具翻车了',
      topic: 'AI 工具',
      kind: 'failure',
      keywords: ['翻车'],
      usedCount: 2,
      createdAt: '2026-08-10T00:00:00.000Z',
    });
    expect(got[1].kind).toBe(''); // 非法 kind 降为空
    expect(got[1].keywords).toEqual([]); // 非数组 keywords 降为空
  });

  it('按 createdAt 降序查询(新鲜度排序依赖它)', async () => {
    vi.mocked(prisma.creatorExperience.findMany).mockResolvedValue([] as never);
    await loadExperiences('u1');
    expect(prisma.creatorExperience.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
