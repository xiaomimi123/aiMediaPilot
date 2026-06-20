export interface InspirationStyleHints {
  hookTypes?: string[];
  titlePatterns?: string[];
  durationInsight?: string;
}

export function formatStyleHints(h?: InspirationStyleHints): string {
  if (!h) return '';
  const hasAny =
    (h.hookTypes && h.hookTypes.length > 0) ||
    (h.titlePatterns && h.titlePatterns.length > 0) ||
    (h.durationInsight && h.durationInsight.length > 0);
  if (!hasAny) return '';
  const lines: string[] = ['', '参考下面对标爆款的共性 (借鉴风格,不要照抄):'];
  if (h.hookTypes && h.hookTypes.length > 0) {
    lines.push(`- 钩子类型: ${h.hookTypes.slice(0, 5).join(' / ')}`);
  }
  if (h.titlePatterns && h.titlePatterns.length > 0) {
    lines.push(`- 标题模式: ${h.titlePatterns.slice(0, 5).join(' / ')}`);
  }
  if (h.durationInsight) {
    lines.push(`- 时长规律: ${h.durationInsight}`);
  }
  return lines.join('\n');
}
