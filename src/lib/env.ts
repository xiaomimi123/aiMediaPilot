/** DeepSeek key 只从 .env 读(设置页录入属阶段 5)。空串视为未配置。 */
export function getDeepSeekKey(): string | null {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k ? k : null;
}
