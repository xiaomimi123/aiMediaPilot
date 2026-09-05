import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, FilmPlanSchema, stripPlanStyle, describeCardsForPrompt } from '@/lib/video-production/shot-plan';
import { SHOT_STYLE_CONTROLS } from '@/lib/video-production/card-controls';

const base = { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement' as const, slots: { text: '一句话' } };

describe('shot.style 契约', () => {
  it('不带 style 的历史 plan 照常解析', () => {
    expect(ShotPlanSchema.safeParse(base).success).toBe(true);
  });

  it('合法 style 通过', () => {
    const r = ShotPlanSchema.safeParse({ ...base, style: { speed: 1.5, accent: 'yellow', scale: 1.2 } });
    expect(r.success).toBe(true);
  });

  it('speed 越界被拒', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { speed: 9 } }).success).toBe(false);
  });

  it('accent 只认枚举内的值 —— 不给自由色盘', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { accent: '#ff0000' } }).success).toBe(false);
  });

  it('style 里的多余字段被 strict 拒绝', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { offsetX: 10 } }).success).toBe(false);
  });
});

describe('模型不碰 style 的保证', () => {
  it('卡片说明里一个字都不提 style/speed/accent', () => {
    const text = describeCardsForPrompt();
    expect(text).not.toMatch(/style|speed|accent|强调色|动画速度/);
  });

  it('stripPlanStyle 剥掉模型意外产出的 style, 其余原样', () => {
    const plan = { shots: [{ ...base, style: { speed: 2 } }] } as never;
    const out = stripPlanStyle(plan);
    expect(out.shots[0]).not.toHaveProperty('style');
    expect(out.shots[0].slots).toEqual({ text: '一句话' });
    expect(FilmPlanSchema.safeParse(out).success).toBe(true);
  });
});

describe('参数控件声明', () => {
  it('三个控件: speed/accent/scale, 与 schema 的范围一致', () => {
    const keys = SHOT_STYLE_CONTROLS.map((c) => c.key);
    expect(keys).toEqual(['speed', 'accent', 'scale']);
    const speed = SHOT_STYLE_CONTROLS[0] as { min: number; max: number };
    expect([speed.min, speed.max]).toEqual([0.3, 3]);
    const scale = SHOT_STYLE_CONTROLS[2] as { min: number; max: number };
    expect([scale.min, scale.max]).toEqual([0.6, 1.6]);
  });
});
