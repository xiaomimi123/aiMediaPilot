/**
 * TTS 音色/资源档位优先级解析(二十期收尾, task-10b 缺口1)。
 *
 * 凭据(apiKey)刻意不出现在这个函数里——它是账号级密钥, 永远来自 VolcTtsConfig,
 * 不属于模板也不该被临时覆盖; 调用方(worker)直接用全局 ttsConfig.apiKey, 不经过这条链。
 * 逐字段(而非整体对象)取优先级, 是为了让 produce API 的 voiceOverride 允许只改
 * voiceType 或只改 resourceId 而不必两个都填——半个覆盖对象不该让另一半字段变成
 * undefined 吞掉模板/全局的既有值。
 */
export interface VoiceSelectable {
  voiceType?: string;
  resourceId?: string;
}

export interface ResolvedTtsVoice {
  voiceType: string;
  resourceId: string;
}

export function resolveTtsVoiceSelection(params: {
  voiceOverride?: VoiceSelectable | null;
  templateVoicePreset?: VoiceSelectable | null;
  globalConfig: ResolvedTtsVoice;
}): ResolvedTtsVoice {
  const { voiceOverride, templateVoicePreset, globalConfig } = params;
  return {
    voiceType: voiceOverride?.voiceType ?? templateVoicePreset?.voiceType ?? globalConfig.voiceType,
    resourceId: voiceOverride?.resourceId ?? templateVoicePreset?.resourceId ?? globalConfig.resourceId,
  };
}
