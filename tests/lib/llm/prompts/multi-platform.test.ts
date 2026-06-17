import { describe, expect, it } from 'vitest';
import { XHSScriptResponseSchema, SCRIPT_GENERATE_XIAOHONGSHU } from '@/lib/llm/prompts/script-generate-xiaohongshu';
import { ArticleScriptResponseSchema, SCRIPT_GENERATE_GONGZHONGHAO } from '@/lib/llm/prompts/script-generate-gongzhonghao';

describe('XHS schema', () => {
  it('合法数据通过', () => {
    const valid = {
      titles: [
        { text: '✨打工人变效率怪', hookType: '情感' },
        { text: '老板都夸的周报秘籍', hookType: '反差' },
        { text: '3 个 ChatGPT 周报 prompt', hookType: '数字' },
      ],
      coverText: '周报 3 分钟',
      intro: '你是不是也每周写周报花 2 小时? 我用 ChatGPT 后老板说我变了, 但秘密真的只是 3 个 prompt 调整...',
      body: '# 怎么用\n\n第一步, 把工作记录喂进去...\n\n第二步...\n\n第三步: 让 AI 用你的口吻\n\n'.padEnd(160, '补充内容'),
      tags: ['ChatGPT', 'AI 工具', '打工人', '效率', '副业'],
      shotIdeas: [
        { idx: 1, description: 'ChatGPT 输入框截图, prompt 示范' },
        { idx: 2, description: '工作记录 vs 周报 对比图' },
        { idx: 3, description: '最终周报截图' },
      ],
    };
    expect(XHSScriptResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('intro 太短 (< 20 字) → 失败', () => {
    const invalid = {
      titles: [
        { text: '✨ 打工人变效率怪', hookType: '情感' },
        { text: '✨ 老板都夸的周报秘籍', hookType: '反差' },
        { text: '✨ 3 个 ChatGPT 周报 prompt', hookType: '数字' },
      ],
      coverText: '周报 3 分钟',
      intro: '太短',
      body: '正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文',
      tags: ['ChatGPT', 'AI', '工具'],
      shotIdeas: [
        { idx: 1, description: '图描述图描述' },
        { idx: 2, description: '图描述图描述' },
        { idx: 3, description: '图描述图描述' },
      ],
    };
    expect(XHSScriptResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('buildSystemPrompt 包含 niche persona + 任务说明', () => {
    const p = SCRIPT_GENERATE_XIAOHONGSHU.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/小红书/);
    expect(p.length).toBeGreaterThan(200);
  });
});

describe('公众号 schema', () => {
  it('合法数据通过', () => {
    const valid = {
      titles: [
        { text: 'ChatGPT 写周报: 3 个不为人知的 prompt 技巧', hookType: '数字' },
        { text: '为什么 90% 的人用 AI 写周报反而更慢', hookType: '反差' },
        { text: 'AI 写周报: 一个产品经理的 6 周复盘', hookType: '权威' },
      ],
      abstract: '本文分享一个产品经理用 ChatGPT 改造周报流程的 6 周实践, 涵盖 3 个关键 prompt 技巧和 2 个常见误区, 帮助你把每周 2 小时压缩到 15 分钟。',
      outline: [
        '问题: 周报为什么难写',
        '误区: 直接让 AI 写的 3 个坑',
        '方法: 喂 AI 工作记录的 3 步',
        '进阶: 让 AI 用你的语气',
        '结语与总结',
      ],
      body: '## 问题\n\n周报难写,本质是工作记录散...\n\n## 误区\n\n大多数人...\n\n## 方法\n\n第一步...第二步...第三步...\n\n## 进阶\n\n...\n\n## 结语\n\n...'.padEnd(900, '内容'),
      cta: '你怎么用 AI 写周报? 评论区分享你的 prompt, 我选 3 个有意思的下篇做案例。',
    };
    expect(ArticleScriptResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('buildSystemPrompt 包含 公众号 任务说明', () => {
    const p = SCRIPT_GENERATE_GONGZHONGHAO.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/公众号|长文/);
    expect(p.length).toBeGreaterThan(200);
  });
});
