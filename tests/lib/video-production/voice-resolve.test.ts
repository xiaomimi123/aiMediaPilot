import { describe, expect, it } from 'vitest';
import { resolveTtsVoiceSelection } from '@/lib/video-production/voice-resolve';

const GLOBAL = { voiceType: 'global-voice', resourceId: 'global-resource' };

describe('resolveTtsVoiceSelection (缺口1: template.voicePreset 全链路消费方)', () => {
  it('有 voiceOverride 时优先用它', () => {
    const result = resolveTtsVoiceSelection({
      voiceOverride: { voiceType: 'override-voice', resourceId: 'override-resource' },
      templateVoicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
      globalConfig: GLOBAL,
    });
    expect(result).toEqual({ voiceType: 'override-voice', resourceId: 'override-resource' });
  });

  it('无覆盖但有模板 voicePreset 时用模板', () => {
    const result = resolveTtsVoiceSelection({
      voiceOverride: null,
      templateVoicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
      globalConfig: GLOBAL,
    });
    expect(result).toEqual({ voiceType: 'template-voice', resourceId: 'template-resource' });
  });

  it('两者都无时用全局配置(零迁移: templateId 为空的旧入口就是这条路径)', () => {
    const result = resolveTtsVoiceSelection({
      voiceOverride: null,
      templateVoicePreset: null,
      globalConfig: GLOBAL,
    });
    expect(result).toEqual(GLOBAL);
  });

  it('临时覆盖只给了 voiceType 时, resourceId 仍按优先级链取模板/全局, 不会被覆盖对象里缺失的字段污染成 undefined', () => {
    const result = resolveTtsVoiceSelection({
      voiceOverride: { voiceType: 'override-voice' },
      templateVoicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
      globalConfig: GLOBAL,
    });
    expect(result).toEqual({ voiceType: 'override-voice', resourceId: 'template-resource' });
  });

  it('apiKey 永远来自全局配置, 不受模板/覆盖影响 —— 这个函数的返回值里根本不含 apiKey, 调用方必须直接用全局 ttsConfig.apiKey', () => {
    const result = resolveTtsVoiceSelection({
      voiceOverride: { voiceType: 'override-voice', resourceId: 'override-resource' },
      templateVoicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
      globalConfig: GLOBAL,
    });
    expect(result).not.toHaveProperty('apiKey');
    expect(Object.keys(result).sort()).toEqual(['resourceId', 'voiceType']);
  });
});
