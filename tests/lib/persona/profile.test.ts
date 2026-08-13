import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  personaProfile: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  isProfileEstablished,
  loadPersonaProfile,
  validatePillarHit,
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
