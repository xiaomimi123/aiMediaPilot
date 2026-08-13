/**
 * 雷达条目卡「人设徽标」条件判断 — 纯函数, 从 `radar.tsx` 展示逻辑抽出以便单测
 * (八期 T5, spec §3 heatFactors 后处理约定)。
 *
 * heatFactors 由 `run.ts` 写入 (见 heatFactors: { ..., personaAdjust, pillarHit }),
 * 但老条目 (本期上线前采集的) 没有 `personaAdjust`/`pillarHit` 这两个键——展示层
 * 缺字段不渲染徽标、不调权 (零迁移, spec §5 风险表), 所以这里对任意非本期形状的
 * 输入一律宽进严出地返回 null, 不抛错。
 *
 * 三态之外的一切输入 (包括 pillarHit 缺一半字段、空字符串等边界) 都归为 null——
 * 「没有徽标」永远是安全的默认值。
 */
export type PersonaBadge = { type: 'pillar'; name: string } | { type: 'off' };

export function pickPersonaBadge(heatFactors: unknown): PersonaBadge | null {
  if (typeof heatFactors !== 'object' || heatFactors === null) return null;

  const obj = heatFactors as Record<string, unknown>;
  if (!('pillarHit' in obj) || !('personaAdjust' in obj)) return null;

  const { pillarHit, personaAdjust } = obj;

  if (typeof pillarHit === 'string' && pillarHit.length > 0) {
    return { type: 'pillar', name: pillarHit };
  }

  if (pillarHit === null && typeof personaAdjust === 'number' && personaAdjust < 0) {
    return { type: 'off' };
  }

  return null;
}
