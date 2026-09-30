import { describe, expect, it } from 'vitest';
import { formatReference } from '@/lib/benchmark/adopt';

describe('formatReference', () => {
  it('lists author, ratio, analysis and transcript', () => {
    const t = formatReference({
      author: '园长说AI',
      ratio: 4.5,
      transcript: '很多人对AI的印象还停留在聊天写代码',
      analysis: { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签', fit: 'high', fitReason: '对上效率革命', myAngle: '讲你实测的工具' },
    });
    expect(t).toContain('博主：园长说AI（点赞是他平时的 4.5 倍）');
    expect(t).toContain('选题：AI 帮听障摊主做生意');
    expect(t).toContain('开头钩子（反常识）：很多人对AI的印象还停留在聊天写代码');
    expect(t).toContain('【逐字稿】\n很多人对AI的印象还停留在聊天写代码');
  });
});
