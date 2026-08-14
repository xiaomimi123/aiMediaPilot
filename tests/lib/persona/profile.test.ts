import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  personaProfile: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  isProfileEstablished,
  loadPersonaProfile,
  validatePillarHit,
  validateIntent,
  parsePersonaPains,
  parsePersonaOfferings,
  parseMarketInsight,
  PersonaProfileSchema,
  type PersonaProfileData,
} from '@/lib/persona/profile';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeProfile(overrides: Partial<PersonaProfileData> = {}): PersonaProfileData {
  return {
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
    painPoints: [],
    offerings: [],
    productLogic: '',
    marketInsight: null,
    systemSummary: '',
    ...overrides,
  };
}

describe('isProfileEstablished', () => {
  it('audience 非空 + pillars 非空 → true', () => {
    expect(isProfileEstablished(makeProfile())).toBe(true);
  });

  it('audience 空串 → false', () => {
    expect(isProfileEstablished(makeProfile({ audience: '' }))).toBe(false);
  });

  it('audience 只有空白 → false', () => {
    expect(isProfileEstablished(makeProfile({ audience: '   ' }))).toBe(false);
  });

  it('pillars 空数组 → false', () => {
    expect(isProfileEstablished(makeProfile({ pillars: [] }))).toBe(false);
  });

  it('audience 非空但 pillars 空 → false', () => {
    expect(isProfileEstablished(makeProfile({ audience: '有受众', pillars: [] }))).toBe(false);
  });
});

describe('PersonaProfileSchema', () => {
  it('合法数据 → 通过', () => {
    const parsed = PersonaProfileSchema.safeParse(makeProfile());
    expect(parsed.success).toBe(true);
  });

  it('pillars 超过 5 条 → 失败', () => {
    const pillars = Array.from({ length: 6 }, (_, i) => ({ name: `支柱${i}`, description: '' }));
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ pillars }));
    expect(parsed.success).toBe(false);
  });

  it('pillar name 超过 10 字 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(
      makeProfile({ pillars: [{ name: '一二三四五六七八九十一', description: '' }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it('audience 超过 300 字 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ audience: 'a'.repeat(301) }));
    expect(parsed.success).toBe(false);
  });

  it('painPoints 超过 6 条 → 失败', () => {
    const painPoints = Array.from({ length: 7 }, (_, i) => ({ pain: `痛点${i}`, evidence: '' }));
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ painPoints }));
    expect(parsed.success).toBe(false);
  });

  it('pain 超过 30 字 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(
      makeProfile({ painPoints: [{ pain: 'a'.repeat(31), evidence: '' }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it('offering type 非枚举 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(
      makeProfile({
        offerings: [
          { name: '产品A', type: 'saas' as unknown as 'tool', description: '', targetPain: '' },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('offerings 合法枚举 (tool/service/course) → 通过', () => {
    const parsed = PersonaProfileSchema.safeParse(
      makeProfile({
        offerings: [
          { name: '产品A', type: 'tool', description: '', targetPain: '' },
          { name: '服务B', type: 'service', description: '', targetPain: '' },
          { name: '课程C', type: 'course', description: '', targetPain: '' },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('productLogic 超过 500 字 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ productLogic: 'a'.repeat(501) }));
    expect(parsed.success).toBe(false);
  });

  it('systemSummary 超过 2000 字 → 失败', () => {
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ systemSummary: 'a'.repeat(2001) }));
    expect(parsed.success).toBe(false);
  });

  it('marketInsight 为 null → 通过', () => {
    const parsed = PersonaProfileSchema.safeParse(makeProfile({ marketInsight: null }));
    expect(parsed.success).toBe(true);
  });

  it('marketInsight 各字段齐全 → 通过', () => {
    const parsed = PersonaProfileSchema.safeParse(
      makeProfile({
        marketInsight: {
          landscape: '赛道格局', mainstream: '主流玩法', unmet: '未满足需求',
          opportunity: '机会点', researchedAt: '2026-08-15',
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('loadPersonaProfile', () => {
  it('无行 → null', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce(null);
    const result = await loadPersonaProfile('u1');
    expect(result).toBeNull();
    expect(prismaMock.personaProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('有行但未建立 (audience 为空) → null', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '',
      targetFans: '',
      pillars: [],
      angle: '',
      avoid: '',
    });
    const result = await loadPersonaProfile('u1');
    expect(result).toBeNull();
  });

  it('有行且已建立 → 返回结构化数据', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '25-35 岁互联网从业者',
      targetFans: '想转行做 AI 的人',
      pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
      angle: '只讲能落地的方法',
      avoid: '不做标题党',
    });
    const result = await loadPersonaProfile('u1');
    expect(result).toEqual(makeProfile());
  });

  it('pillars 非数组 → 防御为空数组', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: { not: 'an array' },
      angle: '',
      avoid: '',
    });
    const result = await loadPersonaProfile('u1');
    // pillars 变空 → isProfileEstablished 判定为 false → null
    expect(result).toBeNull();
  });

  it('pillars 含缺 name 的畸形条目 → 丢弃该条目, 保留其余', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [
        { description: '缺 name' },
        { name: '工具评测', description: '拆解 AI 工具实际效果' },
      ],
      angle: '',
      avoid: '',
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.pillars).toEqual([{ name: '工具评测', description: '拆解 AI 工具实际效果' }]);
  });

  it('pillars 含 name 非字符串的畸形条目 → 丢弃该条目', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [
        { name: 123, description: 'name 不是字符串' },
        { name: '工具评测', description: '拆解 AI 工具实际效果' },
      ],
      angle: '',
      avoid: '',
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.pillars).toEqual([{ name: '工具评测', description: '拆解 AI 工具实际效果' }]);
  });

  it('pillars 条目非对象 (如 null / 字符串) → 丢弃该条目', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [null, 'not an object', { name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.pillars).toEqual([{ name: '工具评测', description: '' }]);
  });

  it('八期已建档用户新字段为空 (undefined) → 新字段行为不变, 全部回退空值', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '25-35 岁互联网从业者',
      targetFans: '想转行做 AI 的人',
      pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
      angle: '只讲能落地的方法',
      avoid: '不做标题党',
      // painPoints/offerings/productLogic/marketInsight/systemSummary 均缺失 (八期存量行)
    });
    const result = await loadPersonaProfile('u1');
    expect(result).toEqual(makeProfile());
  });

  it('painPoints 非数组 → 防御为空数组', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      painPoints: { not: 'an array' },
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.painPoints).toEqual([]);
  });

  it('painPoints 含缺 pain 字段的畸形条目 → 丢弃该条目, 保留其余', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      painPoints: [
        { evidence: '缺 pain' },
        { pain: '效率低', evidence: '证据' },
      ],
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.painPoints).toEqual([{ pain: '效率低', evidence: '证据' }]);
  });

  it('offerings 非数组 → 防御为空数组', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      offerings: 'not an array',
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.offerings).toEqual([]);
  });

  it('offerings 含缺 name 字段的畸形条目 → 丢弃该条目, 保留其余', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      offerings: [
        { type: 'tool', description: '缺 name' },
        { name: '产品A', type: 'tool', description: '', targetPain: '' },
      ],
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.offerings).toEqual([{ name: '产品A', type: 'tool', description: '', targetPain: '' }]);
  });

  it('marketInsight 缺任一字段 → null', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      marketInsight: { landscape: '格局', mainstream: '主流' }, // 缺 unmet/opportunity/researchedAt
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.marketInsight).toBeNull();
  });

  it('marketInsight 非对象 → null', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      marketInsight: 'not an object',
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.marketInsight).toBeNull();
  });

  it('marketInsight 字段齐全 → 完整返回', async () => {
    const insight = {
      landscape: '格局', mainstream: '主流', unmet: '未满足',
      opportunity: '机会', researchedAt: '2026-08-15',
    };
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      audience: '有受众',
      targetFans: '',
      pillars: [{ name: '工具评测', description: '' }],
      angle: '',
      avoid: '',
      marketInsight: insight,
    });
    const result = await loadPersonaProfile('u1');
    expect(result?.marketInsight).toEqual(insight);
  });
});

describe('parsePersonaPains / parsePersonaOfferings / parseMarketInsight (单元)', () => {
  it('parsePersonaPains: 非数组 → []', () => {
    expect(parsePersonaPains(null)).toEqual([]);
    expect(parsePersonaPains(undefined)).toEqual([]);
    expect(parsePersonaPains('str')).toEqual([]);
  });

  it('parsePersonaOfferings: 非数组 → []', () => {
    expect(parsePersonaOfferings(null)).toEqual([]);
    expect(parsePersonaOfferings({})).toEqual([]);
  });

  it('parseMarketInsight: 非对象 → null', () => {
    expect(parseMarketInsight(null)).toBeNull();
    expect(parseMarketInsight(undefined)).toBeNull();
    expect(parseMarketInsight('str')).toBeNull();
    expect(parseMarketInsight([])).toBeNull();
  });
});

describe('validateIntent', () => {
  it("'reach'/'trust'/'convert' → 原样返回", () => {
    expect(validateIntent('reach')).toBe('reach');
    expect(validateIntent('trust')).toBe('trust');
    expect(validateIntent('convert')).toBe('convert');
  });

  it("非法字符串 → ''", () => {
    expect(validateIntent('Reach')).toBe('');
    expect(validateIntent('REACH')).toBe('');
    expect(validateIntent('unknown')).toBe('');
    expect(validateIntent('')).toBe('');
  });

  it("null/undefined → ''", () => {
    expect(validateIntent(null)).toBe('');
    expect(validateIntent(undefined)).toBe('');
  });

  it("数字/对象/数组等非字符串输入 → ''", () => {
    expect(validateIntent(1)).toBe('');
    expect(validateIntent({})).toBe('');
    expect(validateIntent([])).toBe('');
    expect(validateIntent(true)).toBe('');
  });
});

describe('validatePillarHit', () => {
  const pillars = [
    { name: '工具评测', description: '拆解 AI 工具实际效果' },
    { name: '行业观察', description: '' },
  ];

  it('严格等于某 pillar.name → 返回该 name', () => {
    expect(validatePillarHit('工具评测', pillars)).toBe('工具评测');
  });

  it('大小写不同 → null', () => {
    const englishPillars = [{ name: 'AI Tools', description: '' }];
    expect(validatePillarHit('ai tools', englishPillars)).toBeNull();
  });

  it('前后空格不同 → null', () => {
    expect(validatePillarHit(' 工具评测 ', pillars)).toBeNull();
  });

  it('不存在的 name → null', () => {
    expect(validatePillarHit('不存在的支柱', pillars)).toBeNull();
  });

  it('非字符串输入 → null', () => {
    expect(validatePillarHit(123, pillars)).toBeNull();
    expect(validatePillarHit(null, pillars)).toBeNull();
    expect(validatePillarHit(undefined, pillars)).toBeNull();
  });

  it('pillars 为空数组 → null', () => {
    expect(validatePillarHit('工具评测', [])).toBeNull();
  });
});
