/** 各家 SDK 的报错 → 中文"原因 + 怎么办", 带模型名 */
export function explainModelError(e: unknown, label: string): string {
  const err = e as { status?: number; code?: string; message?: string };
  const msg = err?.message ?? String(e);
  const status = err?.status ?? Number(/\b(40[1-4]|429|5\d\d)\b/.exec(msg)?.[1] ?? 0);
  if (status === 401 || status === 403) return `${label}拒绝了请求：key 无效或没有权限，去设置页检查这个模型的 key。`;
  if (status === 402) return `${label}余额不足：去厂商后台充值后再试。`;
  if (status === 429) return `${label}请求太频繁或额度用完：等一会儿再试，或换一个模型。`;
  if (status === 404) return `${label}找不到：模型名不对或接口地址不对，去设置页核对。`;
  if (status >= 500) return `${label}服务端出错（${status}）：稍后再试。`;
  const local = /localhost|127\.0\.0\.1/.test(msg);
  if (err?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return local ? `连不上本地模型 ${label}：先运行 Ollama，再重试。` : `连不上 ${label}：检查网络和接口地址。`;
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|timeout/i.test(msg)) return `连不上 ${label}：检查网络和接口地址。`;
  return `${label}出错了：${msg.slice(0, 120)}`;
}
