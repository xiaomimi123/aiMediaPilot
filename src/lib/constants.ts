export const APP_NAME = 'MediaPilot';

export const AI_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  // Phase 4 再补:
  // { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest' },
  // { id: 'zhipu',     label: '智谱 GLM',  defaultModel: 'glm-4-flash' },
  // { id: 'qwen',      label: '通义千问',  defaultModel: 'qwen-turbo' },
  // { id: 'doubao',    label: '豆包',     defaultModel: 'doubao-pro-32k' },
] as const;

export type AIProviderId = (typeof AI_PROVIDERS)[number]['id'];
