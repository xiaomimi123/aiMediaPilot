/** 所有维度共享的输出约定。Append 到 systemPrompt 尾部。 */
export const JSON_STRICTNESS = `
输出格式: 严格 JSON, 不要有任何 markdown 代码块标记, 不要有解释文字, 直接 JSON。
所有字符串字段使用中文。timestampSec 用秒数 (浮点),不要用 "0:18" 这种字符串。
`.trim();
