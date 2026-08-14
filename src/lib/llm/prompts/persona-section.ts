import type { PersonaProfileData } from '@/lib/persona/profile';
import type { ContentIntent } from '@/lib/cockpit/model';

/**
 * 把人设定位档案渲染成 system prompt 里的一段结构化中文文字 —
 * 供选题生成/写稿类 prompt 注入, 让 AI 按博主自己的定位来产出而不是泛泛而谈。
 *
 * 十期: 账号定位体系扩展 — 档案新增 painPoints/offerings/productLogic/marketInsight/
 * systemSummary 五个字段, 若还是像八期那样整份倒进 prompt 会把指令稀释、把 prompt 撑长。
 * 改为按用途 (`scope`) 分段导出, 每个调用点只拿到自己需要的子集:
 * - 'radar'：受众 + 内容支柱 + 用户痛点 + 市场机会位 (雷达评分要判断"是否戳中痛点/是否踩中机会")
 * - 'write'：受众 + 用户痛点 + 差异化角度 + 市场机会位 (+ intent 非空时追加 CTA 指引段)
 *   (写稿要贴痛点写、要有差异化切入、结尾要按 intent 收口 — 不需要支柱列表)
 * - 'topic'：受众 + 内容支柱 + 用户痛点 (选题发散要覆盖支柱又不脱离受众/痛点)
 * 全档案任何时候都不整体倒进 prompt。
 *
 * 未建立档案 (null) → 空串, 调用方直接拼接不需要额外判空。
 * 单个字段为空 → 该字段对应的行/段整体省略, 不产出空标签行。
 */
export type PersonaSectionScope = 'radar' | 'write' | 'topic';

function pushAudienceLines(lines: string[], profile: PersonaProfileData): void {
  if (profile.audience.trim()) lines.push(`目标受众: ${profile.audience}`);
  if (profile.targetFans.trim()) lines.push(`想吸引的粉丝: ${profile.targetFans}`);
}

function pushPillarLines(lines: string[], profile: PersonaProfileData): void {
  if (profile.pillars.length === 0) return;
  lines.push('内容支柱:');
  for (const pillar of profile.pillars) {
    lines.push(`- ${pillar.name}: ${pillar.description}`);
  }
}

function pushPainLines(lines: string[], profile: PersonaProfileData): void {
  if (profile.painPoints.length === 0) return;
  lines.push('用户痛点:');
  for (const pain of profile.painPoints) {
    lines.push(`- ${pain.pain}: ${pain.evidence}`);
  }
}

/** 市场机会位: 只取 unmet(未满足需求)/opportunity(差异化机会) 两段, landscape/mainstream 不注入(避免复述红海现状占篇幅)。 */
function pushOpportunityLines(lines: string[], profile: PersonaProfileData): void {
  const insight = profile.marketInsight;
  if (!insight) return;
  const unmet = insight.unmet.trim();
  const opportunity = insight.opportunity.trim();
  if (!unmet && !opportunity) return;
  lines.push('市场机会位:');
  if (unmet) lines.push(`- 未满足需求: ${insight.unmet}`);
  if (opportunity) lines.push(`- 差异化机会: ${insight.opportunity}`);
}

/** CTA 指引段: 只在 scope='write' 且 intent 非空时追加, 三套文案照 intent 分岔 (reach/trust/convert)。 */
function pushCtaLines(lines: string[], profile: PersonaProfileData, intent: ContentIntent | undefined): void {
  if (!intent) return;

  if (intent === 'reach') {
    lines.push(
      'CTA 指引 (引流): 结尾自然引导观众互动/关注 — 给一个具体的互动钩子(提问/投票/求补充案例), 不要用"记得点关注"这类生硬话术。',
    );
    return;
  }

  if (intent === 'trust') {
    lines.push(
      'CTA 指引 (建立信任): 结尾引导观众收藏本条, 并提示主页还有更多同类案例可看, 强化专业感与可复用性, 不做硬性引流话术。',
    );
    return;
  }

  // intent === 'convert'
  if (profile.offerings.length > 0) {
    lines.push('CTA 指引 (转化): 结尾场景化地自然带出以下产品/服务, 禁止生硬广告话术:');
    for (const offering of profile.offerings) {
      lines.push(`- ${offering.name}: ${offering.description}`);
    }
  } else {
    lines.push('CTA 指引 (转化): 结尾场景化地引导观众了解你的产品/服务, 禁止生硬广告话术。');
  }
}

export function buildPersonaSection(
  profile: PersonaProfileData | null,
  scope: PersonaSectionScope,
  intent?: ContentIntent,
): string {
  if (!profile) return '';

  const lines: string[] = [];

  if (scope === 'radar') {
    pushAudienceLines(lines, profile);
    pushPillarLines(lines, profile);
    pushPainLines(lines, profile);
    pushOpportunityLines(lines, profile);
  } else if (scope === 'write') {
    pushAudienceLines(lines, profile);
    pushPainLines(lines, profile);
    if (profile.angle.trim()) lines.push(`差异化角度: ${profile.angle}`);
    pushOpportunityLines(lines, profile);
    pushCtaLines(lines, profile, intent);
  } else {
    // scope === 'topic'
    pushAudienceLines(lines, profile);
    pushPillarLines(lines, profile);
    pushPainLines(lines, profile);
  }

  return lines.join('\n');
}
