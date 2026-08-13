import { describe, expect, it } from 'vitest';
import {
  ResearchBriefSchema,
  RESEARCH_BRIEF,
  type ResearchBrief,
} from '@/lib/llm/prompts/research-brief';
import {
  ScriptSectionSchema,
  DouyinFullScriptSchema,
  SCRIPT_WRITE_DOUYIN,
  type StyleContext,
} from '@/lib/llm/prompts/script-write-douyin';
import { SCRIPT_REFINE } from '@/lib/llm/prompts/script-refine';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBrief: ResearchBrief = {
  points: [
    {
      fact: 'GPT-5 发布后 3 个月内相关论文引用量增长了 240%',
      source: 'https://example.com/report',
      usage: '作为 hook 部分的数据反差',
    },
    {
      fact: '某电商团队用 AI 客服后, 人工客服工时下降了 62%',
      source: '用户素材',
      usage: 'main 部分举例佐证',
    },
  ],
};

const validSections = [
  { role: 'hook' as const, startSec: 0, endSec: 5, text: '你知道吗, 90% 的人都用错了这个功能, 今天教你正确用法' },
  { role: 'main' as const, startSec: 5, endSec: 25, text: '首先第一步很简单, 打开设置页面, 找到对应选项, 点击开启, 然后你就会发现效果立刻不一样' },
  { role: 'cta' as const, startSec: 25, endSec: 30, text: '如果你也遇到这个问题, 评论区告诉我, 关注我下期继续分享' },
];

const validFullScript = {
  sections: validSections,
  hooks: [
    { text: '90% 的人都用错了这个功能', rationale: '反差数字制造好奇' },
    { text: '这个功能你可能一直用错了', rationale: '悬念钩子引发好奇' },
    { text: '一分钟教你用对这个功能', rationale: '承诺型钩子给出明确价值' },
  ],
  titles: [
    { text: '90% 的人都用错的功能', hookType: '数字' },
    { text: '你一直用错的这个功能', hookType: '反差' },
    { text: '一分钟学会正确用法', hookType: '承诺' },
  ],
  cover: { textOverlay: '用对了吗', shotIdea: '手指点击设置页面特写', colorTone: '白底红字高对比' },
};

const descStyle: StyleContext = {
  mode: 'description',
  description: '语速快, 喜欢用反问句开场, 经常自嘲, 用词口语化不端着',
  samples: [],
};

const sampleText1 = '大家好, 我是小明, 今天我们来聊聊这个新功能到底好不好用, 别急着划走';
const samplesStyle: StyleContext = {
  mode: 'samples',
  description: '',
  samples: [sampleText1, '上次说的那个方法, 好多人问我细节, 今天一次性讲清楚'],
};

// ---------------------------------------------------------------------------
// research-brief.ts
// ---------------------------------------------------------------------------

describe('ResearchBriefSchema', () => {
  it('合法输入解析通过', () => {
    expect(() => ResearchBriefSchema.parse(validBrief)).not.toThrow();
  });

  it('points 为空数组 → 拒绝 (min 1)', () => {
    expect(() => ResearchBriefSchema.parse({ points: [] })).toThrow();
  });

  it('points 超过 6 条 → 拒绝', () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      fact: `事实点 ${i} 具体细节数字案例说明`,
      source: '用户素材',
      usage: '用在正文里',
    }));
    expect(() => ResearchBriefSchema.parse({ points })).toThrow();
  });

  it('points 恰好 6 条 → 通过', () => {
    const points = Array.from({ length: 6 }, (_, i) => ({
      fact: `事实点 ${i} 具体细节数字案例说明`,
      source: '用户素材',
      usage: '用在正文里',
    }));
    expect(() => ResearchBriefSchema.parse({ points })).not.toThrow();
  });

  it('fact 少于 5 字 → 拒绝', () => {
    expect(() =>
      ResearchBriefSchema.parse({ points: [{ fact: '短', source: 'x', usage: '用途说明' }] })
    ).toThrow();
  });

  it('fact 超过 200 字 → 拒绝', () => {
    expect(() =>
      ResearchBriefSchema.parse({
        points: [{ fact: '字'.repeat(201), source: 'x', usage: '用途说明' }],
      })
    ).toThrow();
  });

  it('usage 少于 2 字 → 拒绝', () => {
    expect(() =>
      ResearchBriefSchema.parse({ points: [{ fact: '足够长的事实描述内容', source: 'x', usage: '短' }] })
    ).toThrow();
  });

  it('source 为空字符串 → 拒绝', () => {
    expect(() =>
      ResearchBriefSchema.parse({ points: [{ fact: '足够长的事实描述内容', source: '', usage: '用途说明' }] })
    ).toThrow();
  });
});

describe('RESEARCH_BRIEF.buildSystemPrompt', () => {
  it('包含 niche persona', () => {
    const p = RESEARCH_BRIEF.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/AI 知识/);
  });

  it('说明 fact/source/usage 三个字段的写法要求', () => {
    const p = RESEARCH_BRIEF.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/fact/);
    expect(p).toMatch(/source/);
    expect(p).toMatch(/usage/);
    expect(p).toMatch(/数字|案例/);
    expect(p).toContain('用户素材');
  });

  it('要求提炼 3-6 条素材要点', () => {
    const p = RESEARCH_BRIEF.buildSystemPrompt('ai-knowledge');
    expect(p).toMatch(/3.*6|3-6|3～6/);
  });
});

describe('RESEARCH_BRIEF.buildUserMessage', () => {
  it('包含 topic 与 rawMaterials', () => {
    const parts = RESEARCH_BRIEF.buildUserMessage({
      topic: 'AI 客服取代人工',
      rawMaterials: '这是搜索结果正文和雷达摘要拼接的文本',
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('AI 客服取代人工');
    expect(text).toContain('这是搜索结果正文和雷达摘要拼接的文本');
  });
});

// ---------------------------------------------------------------------------
// script-write-douyin.ts — schema 边界
// ---------------------------------------------------------------------------

describe('ScriptSectionSchema', () => {
  it('合法 section 解析通过', () => {
    expect(() => ScriptSectionSchema.parse(validSections[0])).not.toThrow();
  });

  it('role 非枚举值 → 拒绝', () => {
    expect(() => ScriptSectionSchema.parse({ ...validSections[0], role: 'outro' })).toThrow();
  });

  it('text 少于 10 字 → 拒绝', () => {
    expect(() => ScriptSectionSchema.parse({ ...validSections[0], text: '太短了' })).toThrow();
  });

  it('startSec 为负数 → 拒绝', () => {
    expect(() => ScriptSectionSchema.parse({ ...validSections[0], startSec: -1 })).toThrow();
  });

  it('endSec 为 0 → 拒绝 (positive)', () => {
    expect(() => ScriptSectionSchema.parse({ ...validSections[0], endSec: 0 })).toThrow();
  });

  it('startSec 非整数 → 拒绝', () => {
    expect(() => ScriptSectionSchema.parse({ ...validSections[0], startSec: 1.5 })).toThrow();
  });
});

describe('DouyinFullScriptSchema', () => {
  it('合法完整脚本解析通过', () => {
    expect(() => DouyinFullScriptSchema.parse(validFullScript)).not.toThrow();
  });

  it('sections 只有 2 块 → 拒绝 (min 3)', () => {
    expect(() =>
      DouyinFullScriptSchema.parse({ ...validFullScript, sections: validSections.slice(0, 2) })
    ).toThrow();
  });

  it('sections 有 6 块 → 通过 (max 6)', () => {
    const sixSections = [
      validSections[0],
      { role: 'main' as const, startSec: 5, endSec: 10, text: '第二段内容, 讲一个具体案例细节展开' },
      { role: 'main' as const, startSec: 10, endSec: 15, text: '第三段内容, 继续深入讲解具体做法细节' },
      { role: 'main' as const, startSec: 15, endSec: 20, text: '第四段内容, 再补充一个反例做对比说明' },
      { role: 'main' as const, startSec: 20, endSec: 25, text: '第五段内容, 总结前面讲的核心要点内容' },
      validSections[2],
    ];
    expect(() => DouyinFullScriptSchema.parse({ ...validFullScript, sections: sixSections })).not.toThrow();
  });

  it('sections 有 7 块 → 拒绝 (max 6)', () => {
    const sevenSections = [
      validSections[0],
      { role: 'main' as const, startSec: 5, endSec: 8, text: '第二段内容, 讲一个具体案例细节展开' },
      { role: 'main' as const, startSec: 8, endSec: 11, text: '第三段内容, 继续深入讲解具体做法细节' },
      { role: 'main' as const, startSec: 11, endSec: 14, text: '第四段内容, 再补充一个反例做对比说明' },
      { role: 'main' as const, startSec: 14, endSec: 17, text: '第五段内容, 总结前面讲的核心要点内容' },
      { role: 'main' as const, startSec: 17, endSec: 20, text: '第六段内容, 再补一句过渡衔接下面结尾' },
      validSections[2],
    ];
    expect(() => DouyinFullScriptSchema.parse({ ...validFullScript, sections: sevenSections })).toThrow();
  });

  it('hooks 不是 3 个 → 拒绝', () => {
    expect(() =>
      DouyinFullScriptSchema.parse({ ...validFullScript, hooks: validFullScript.hooks.slice(0, 2) })
    ).toThrow();
  });

  it('titles 不是 3 个 → 拒绝', () => {
    expect(() =>
      DouyinFullScriptSchema.parse({ ...validFullScript, titles: validFullScript.titles.slice(0, 2) })
    ).toThrow();
  });

  it('缺少 cover → 拒绝', () => {
    const { cover, ...rest } = validFullScript;
    expect(() => DouyinFullScriptSchema.parse(rest)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// script-write-douyin.ts — prompt 内容
// ---------------------------------------------------------------------------

describe('SCRIPT_WRITE_DOUYIN.buildSystemPrompt', () => {
  it('包含「逐字稿」要求', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('逐字稿');
  });

  it('要求口语短句、拒绝书面语', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/口语/);
    expect(p).toMatch(/短句/);
  });

  it('要求第一块 hook 最后一块 cta', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/hook/);
    expect(p).toMatch(/cta/);
    expect(p).toMatch(/第一块|首块/);
    expect(p).toMatch(/最后一块|末块/);
  });

  it('要求秒段连续覆盖, 不留空档不重叠', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/连续/);
    expect(p).toMatch(/不留空档|不重叠/);
  });

  it('要求素材简报 fact 引用进正文', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/fact/);
    expect(p).toMatch(/引用/);
  });

  it('mode=description 时嵌入风格说明段', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain(descStyle.description);
  });

  it('mode=samples 时真实嵌入样本文本, 且提示模仿口吻/句式/用词', () => {
    const p = SCRIPT_WRITE_DOUYIN.buildSystemPrompt('ai-knowledge', samplesStyle);
    expect(p).toContain(sampleText1);
    expect(p).toContain(samplesStyle.samples[1]);
    expect(p).toMatch(/口吻|句式|用词/);
  });
});

describe('SCRIPT_WRITE_DOUYIN.buildUserMessage', () => {
  it('包含 topic 与 durationSec', () => {
    const parts = SCRIPT_WRITE_DOUYIN.buildUserMessage({
      topic: 'AI 写周报',
      durationSec: 30,
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('AI 写周报');
    expect(text).toContain('30');
  });

  it('brief 为 null 时不出现素材简报段落', () => {
    const parts = SCRIPT_WRITE_DOUYIN.buildUserMessage({
      topic: 'AI 写周报',
      durationSec: 30,
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).not.toContain('素材简报');
  });

  it('brief 非空时素材 fact 出现在正文, 且带引用指令', () => {
    const parts = SCRIPT_WRITE_DOUYIN.buildUserMessage({
      topic: 'AI 写周报',
      durationSec: 45,
      brief: validBrief,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('素材简报');
    expect(text).toContain(validBrief.points[0].fact);
    expect(text).toContain(validBrief.points[1].fact);
    expect(text).toMatch(/引用/);
  });

  it.each([30, 45, 60] as const)('durationSec=%d 时给出 ±10%% 秒段范围', (duration) => {
    const parts = SCRIPT_WRITE_DOUYIN.buildUserMessage({ topic: 't', durationSec: duration, brief: null });
    const text = (parts[0] as any).text;
    const tolerance = Math.round(duration * 0.1);
    expect(text).toContain(String(duration - tolerance));
    expect(text).toContain(String(duration + tolerance));
  });
});

// ---------------------------------------------------------------------------
// script-refine.ts
// ---------------------------------------------------------------------------

describe('SCRIPT_REFINE.buildSectionSystemPrompt', () => {
  it('要求其余块原样返回', () => {
    const p = SCRIPT_REFINE.buildSectionSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('原样返回');
  });

  it('mode=samples 时嵌入样本文本', () => {
    const p = SCRIPT_REFINE.buildSectionSystemPrompt('ai-knowledge', samplesStyle);
    expect(p).toContain(sampleText1);
  });

  it('包含 niche persona', () => {
    const p = SCRIPT_REFINE.buildSectionSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/AI 知识/);
  });
});

describe('SCRIPT_REFINE.buildAllSystemPrompt', () => {
  it('要求保持块数/role/秒段结构', () => {
    const p = SCRIPT_REFINE.buildAllSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/块数/);
    expect(p).toMatch(/role/);
    expect(p).toMatch(/秒段/);
  });

  it('mode=samples 时嵌入样本文本', () => {
    const p = SCRIPT_REFINE.buildAllSystemPrompt('ai-knowledge', samplesStyle);
    expect(p).toContain(sampleText1);
  });
});

describe('SCRIPT_REFINE.buildUserMessage', () => {
  it('包含 sections 内容与 instruction', () => {
    const parts = SCRIPT_REFINE.buildUserMessage({
      sections: validSections,
      instruction: '把 hook 改得更有反差感',
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain(validSections[0].text);
    expect(text).toContain('把 hook 改得更有反差感');
  });

  it('targetIdx 存在时标明只重写该块', () => {
    const parts = SCRIPT_REFINE.buildUserMessage({
      sections: validSections,
      instruction: '改一下',
      targetIdx: 1,
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/1/);
  });

  it('brief 非空时素材 fact 出现在正文', () => {
    const parts = SCRIPT_REFINE.buildUserMessage({
      sections: validSections,
      instruction: '改一下',
      brief: validBrief,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain(validBrief.points[0].fact);
  });
});

describe('SCRIPT_REFINE.responseSchema', () => {
  it('合法 sections 通过', () => {
    expect(() => SCRIPT_REFINE.responseSchema.parse({ sections: validSections })).not.toThrow();
  });

  it('sections 少于 3 块 → 拒绝', () => {
    expect(() =>
      SCRIPT_REFINE.responseSchema.parse({ sections: validSections.slice(0, 2) })
    ).toThrow();
  });

  it('sections 多于 6 块 → 拒绝', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      role: 'main' as const,
      startSec: i * 5,
      endSec: i * 5 + 5,
      text: `第 ${i} 段内容, 具体讲解一个要点细节展开说明`,
    }));
    expect(() => SCRIPT_REFINE.responseSchema.parse({ sections: seven })).toThrow();
  });
});
