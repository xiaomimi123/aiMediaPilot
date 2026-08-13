import { describe, expect, it } from 'vitest';
import { INSPIRATION_INSIGHT } from '@/lib/llm/prompts/inspiration-insight';

describe('INSPIRATION_INSIGHT.buildSystemPrompt', () => {
  it('缺省 personaSection → 与无参数调用字符级一致', () => {
    expect(INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin', undefined)).toBe(
      INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin'),
    );
    expect(INSPIRATION_INSIGHT.buildSystemPrompt()).toBe(
      INSPIRATION_INSIGHT.buildSystemPrompt(undefined, undefined, undefined),
    );
  });

  it('personaSection 为空串 → 与无参数调用字符级一致', () => {
    expect(INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin', '')).toBe(
      INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin'),
    );
  });

  it('personaSection 非空 → 含受众文本, 拼在任务描述之后、输出结构之前', () => {
    const persona = '目标受众: 25-35 岁互联网从业者\n内容支柱:\n- 工具评测: 拆解 AI 工具实际效果';
    const s = INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin', persona);
    expect(s).toContain('25-35 岁互联网从业者');
    expect(s).toContain('工具评测');
    const personaIdx = s.indexOf('25-35 岁互联网从业者');
    const outputIdx = s.indexOf('输出结构 (按 schema 严格输出):');
    expect(personaIdx).toBeGreaterThan(-1);
    expect(outputIdx).toBeGreaterThan(-1);
    expect(personaIdx).toBeLessThan(outputIdx);
  });

  it('无 personaSection → 不出现"你的定位"段', () => {
    expect(INSPIRATION_INSIGHT.buildSystemPrompt('ai-knowledge', 'douyin')).not.toContain('你的定位');
  });
});
