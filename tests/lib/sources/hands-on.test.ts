import { describe, expect, it } from 'vitest';
import { handsOnIdeaText, type HandsOnPlan } from '@/lib/sources/hands-on';

const plan: HandsOnPlan = {
  title: '我试了 cinecode',
  direction: '装 Node、跑首条片子、看确认环节拦不拦跑偏。',
  hook: '这个项目号称一句话出片，我装了一天，先卡在了第一步……',
  questions: ['装到哪一步最费劲？', '零付费能跑出 MP4 吗？', '最适合什么人？'],
};

describe('handsOnIdeaText（点子池条目文本）', () => {
  it('含标题/讲什么/钩子三段, 建作品时按行解析回来', () => {
    const text = handsOnIdeaText(plan, 'sarpstar/cinecode', 1698);
    expect(text).toContain('【亲测档·sarpstar/cinecode（GitHub 1,698 stars）】');
    expect(text).toContain(`标题方向：${plan.title}`);
    expect(text).toContain(`讲什么：${plan.direction}`);
    expect(text).toContain(`钩子方向：${plan.hook}`);
    // 解析正则(见 api/sources/hands-on route)能取回三个字段
    expect(text.match(/标题方向：(.+)/)?.[1]).toBe(plan.title);
    expect(text.match(/讲什么：(.+)/)?.[1]).toBe(plan.direction);
    expect(text.match(/钩子方向：(.+)/)?.[1]).toBe(plan.hook);
  });

  it('starCount 为 null 时不带 stars 标注', () => {
    const text = handsOnIdeaText(plan, 'x/y', null);
    expect(text).not.toContain('stars');
  });
});
