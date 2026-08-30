import { describe, it, expect } from 'vitest';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';

/*
 * 这三句是画面质量的天花板, 而且是**主动写下的**取舍(「第一版构图从简」),
 * 写下之后没人回来改过。实测确认: 现有版面骨架下发了、模型也照做了, 产出仍然是
 * 幻灯片 —— 因为提示词要的就是幻灯片。锁住它们不许回来。
 */

describe('提示词不许再给画面封顶', () => {
  it('导演提示词里没有「构图从简」', () => {
    const p = DIRECTOR.buildSystemPrompt();
    expect(p).not.toContain('构图从简');
    expect(p).not.toContain('不追求视觉丰富度');
  });

  it('Builder 提示词里没有「构图从简」, 也不要求「不需要复杂运镜」', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60']);
    expect(p).not.toContain('构图从简');
    expect(p).not.toContain('不需要复杂运镜');
  });

  it('Builder 不再要求「停在有内容的终态」—— 那句明说进场做完就停', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60']);
    expect(p).not.toContain('停在有内容的终态');
    // 但「不许空屏」这条硬约束要留着 —— 它防的是另一件事
    expect(p).toContain('不许出现整屏纯色');
  });

  it('illustration 风格不再承诺做不到的手绘效果', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60'], 'illustration');
    // 我们产出的是 HTML, 画不出手绘角色与物件(spec §1.6 订正一)
    expect(p).not.toContain('手绘感');
    expect(p).toContain('扁平');
  });
});
