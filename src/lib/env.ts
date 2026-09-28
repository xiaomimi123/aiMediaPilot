/** DeepSeek key 只从 .env 读; 设置页保存时写 .env 并同步 process.env(src/lib/settings/env-file.ts)。空串视为未配置。 */
export function getDeepSeekKey(): string | null {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k ? k : null;
}
