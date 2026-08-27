import { describe, expect, it } from 'vitest';
import { DIRECTOR, ShotSchema } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import {
  buildAssetSection,
  buildDirectorAssetSection,
  buildAssignedAssetSection,
  type ContentAsset,
} from '@/lib/video-production/asset-manifest';

const ASSETS: ContentAsset[] = [
  { id: 'a1', kind: 'image', description: 'DeepSeek 官方价格表截图', fileName: 'p.png', text: null },
  { id: 'a2', kind: 'table', description: '峰谷单价对比', fileName: null, text: '项目\t空闲\t高峰\n输入\t1.5元\t3.0元' },
];

describe('Shot schema 支持素材指派', () => {
  it('assetIds 可缺省 —— 没有素材的老任务照常解析', () => {
    const shot = {
      shotId: 's1', startMs: 0, endMs: 3000, claim: 'x', visualJob: 'clarify',
      beats: [{ visibleState: 'a', development: 'b' }, { visibleState: 'c', development: 'd' }],
    };
    expect(() => ShotSchema.parse(shot)).not.toThrow();
  });

  it('assetIds 能带上导演指派的素材', () => {
    const shot = {
      shotId: 's1', startMs: 0, endMs: 3000, claim: 'x', visualJob: 'prove',
      beats: [{ visibleState: 'a', development: 'b' }, { visibleState: 'c', development: 'd' }],
      assetIds: ['a1'],
    };
    expect(ShotSchema.parse(shot).assetIds).toEqual(['a1']);
  });
});

describe('buildDirectorAssetSection(给导演看的素材清单)', () => {
  it('没有素材时返回空串 —— 老任务 prompt 字符级不变', () => {
    expect(buildDirectorAssetSection([])).toBe('');
  });

  it('列出素材及其 id, 导演才能在分镜里指派', () => {
    const s = buildDirectorAssetSection(ASSETS);
    expect(s).toContain('a1');
    expect(s).toContain('DeepSeek 官方价格表截图');
  });

  it('要求导演为素材**专门排镜头**, 而不是等 Builder 见缝插针', () => {
    // 上一版失败的根因: 导演不知道有素材, 排不出"展示这张表"的镜头,
    // Builder 只能在既定镜头里被动塞, 结果一次都没塞
    const s = buildDirectorAssetSection(ASSETS);
    expect(s).toMatch(/专门|安排|排一个|留出/);
  });

  it('说明用 assetIds 字段指派', () => {
    expect(buildDirectorAssetSection(ASSETS)).toContain('assetIds');
  });
});

describe('buildAssignedAssetSection(给 Builder 的指派)', () => {
  it('没指派时返回空串', () => {
    expect(buildAssignedAssetSection(ASSETS, [])).toBe('');
    expect(buildAssignedAssetSection(ASSETS, undefined)).toBe('');
  });

  it('只给出被指派的那几份, 不把全部素材再倒一遍', () => {
    const s = buildAssignedAssetSection(ASSETS, ['a1']);
    expect(s).toContain('DeepSeek 官方价格表截图');
    expect(s).not.toContain('峰谷单价对比');
  });

  it('措辞是"必须用"而不是"可以用" —— 指派过的就没有跳过的余地', () => {
    const s = buildAssignedAssetSection(ASSETS, ['a1']);
    expect(s).toMatch(/必须/);
    expect(s).not.toMatch(/可以不用|酌情/);
  });

  it('图片给出可直接引用的相对路径', () => {
    expect(buildAssignedAssetSection(ASSETS, ['a1'])).toContain('<img src="p.png">');
  });

  it('表格给出原始内容', () => {
    expect(buildAssignedAssetSection(ASSETS, ['a2'])).toContain('1.5元');
  });

  it('指派了不存在的 id 时忽略它, 不崩', () => {
    expect(buildAssignedAssetSection(ASSETS, ['nope'])).toBe('');
  });
});

describe('prompt 接线', () => {
  it('DIRECTOR 收素材段, 输出契约仍在末位', () => {
    const p = DIRECTOR.buildSystemPrompt('', '', buildDirectorAssetSection(ASSETS));
    expect(p).toContain('DeepSeek 官方价格表截图');
    expect(p.indexOf('只输出 JSON')).toBeGreaterThan(p.indexOf('DeepSeek 官方价格表截图'));
  });

  it('DIRECTOR 不传素材段时与原来一致(零迁移)', () => {
    expect(DIRECTOR.buildSystemPrompt('', '', '')).toBe(DIRECTOR.buildSystemPrompt('', ''));
  });

  it('BUILDER 的素材段仍走 factsSection 位, 不新增参数', () => {
    const p = BUILDER.buildSystemPrompt(['#111111'], 'card', buildAssignedAssetSection(ASSETS, ['a1']), '');
    expect(p).toContain('<img src="p.png">');
  });
});

describe('buildAssetSection 保持向后兼容', () => {
  it('仍可用于"全部素材"场景', () => {
    expect(buildAssetSection(ASSETS)).toContain('DeepSeek 官方价格表截图');
  });
});
