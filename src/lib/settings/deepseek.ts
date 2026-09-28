export function isValidDeepSeekKey(k: string): boolean {
  return /^sk-[A-Za-z0-9]{20,}$/.test(k.trim());
}

export function maskKey(k: string | null): string | null {
  return k ? `sk-…${k.slice(-4)}` : null;
}

/** 调 DeepSeek 的模型列表接口验证 key(不花钱); 结果写成人话 */
export async function testDeepSeekKey(key: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetcher('https://api.deepseek.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { ok: true, message: '连接成功，这个 key 可以用。' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'DeepSeek 说这个 key 无效，检查是否复制完整或已被删除。' };
    return { ok: false, message: `DeepSeek 返回了异常（${res.status}），稍后再试。` };
  } catch (e) {
    return { ok: false, message: `连不上 DeepSeek（${e instanceof Error ? e.message : String(e)}），检查网络后再试。` };
  }
}
