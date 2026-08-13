import type { PersonaProfileData } from '@/lib/persona/profile';

/**
 * 把人设定位档案渲染成 system prompt 里的一段结构化中文文字 —
 * 供选题生成/写稿类 prompt 注入, 让 AI 按博主自己的定位来产出而不是泛泛而谈。
 *
 * 未建立档案 (null) → 空串, 调用方直接拼接不需要额外判空。
 * 单个字段为空 → 该字段对应的行整行省略, 不产出空标签行。
 */
export function buildPersonaSection(profile: PersonaProfileData | null): string {
  if (!profile) return '';

  const lines: string[] = [];

  if (profile.audience.trim()) lines.push(`目标受众: ${profile.audience}`);
  if (profile.targetFans.trim()) lines.push(`想吸引的粉丝: ${profile.targetFans}`);
  if (profile.pillars.length > 0) {
    lines.push('内容支柱:');
    for (const pillar of profile.pillars) {
      lines.push(`- ${pillar.name}: ${pillar.description}`);
    }
  }
  if (profile.angle.trim()) lines.push(`差异化角度: ${profile.angle}`);
  if (profile.avoid.trim()) lines.push(`忌讳: ${profile.avoid}`);

  return lines.join('\n');
}
