import {
  EXPERIENCE_KIND_LABELS,
  type CreatorVoiceData,
  type ExperienceItem,
  type ExperienceKind,
} from '@/lib/persona/voice';

/**
 * 人物志 + 经历注入段 (十二期 T4)。
 *
 * 与 buildPersonaSection (八/十期) 刻意分开而不是塞进去: 那个管「你做什么生意」并已
 * 有 radar/write/topic 三套 scope 分段逻辑, 两套档案耦在一个函数里会让分段矩阵变成
 * 3×N 难以维护。这里只服务写稿一处, 保持简单。
 *
 * **不含语言风格指引** —— 口吻/句式/口头禅归 StyleProfile 的 StyleContext, 由写稿
 * prompt 另行注入。人物志只回答「你是谁」。
 */

const GUARDRAIL =
  '这些是你的真实经历, 优先用它们而不是外部案例; 但不相关就别用, 不要硬凑 —— 硬塞不相关的经历比没有经历更糟。';

function kindLabel(kind: string): string {
  return EXPERIENCE_KIND_LABELS[kind as ExperienceKind] ?? '';
}

/**
 * @param voice 人物志; null = 未建立 (loadCreatorVoice 已按 identity 判定)
 * @param experiences 已由 matchExperiences 检索命中的经历 (调用方负责限流, 这里不再截断)
 * @returns 拼接段; 两者皆空时返回 '' —— 调用方据此保持与十二期之前字符级一致
 */
export function buildVoiceSection(
  voice: CreatorVoiceData | null,
  experiences: ExperienceItem[],
): string {
  const blocks: string[] = [];

  if (voice) {
    const lines: string[] = ['你本人是这样一个创作者:'];
    lines.push(`- 身份: ${voice.identity}`);
    if (voice.notIdentity.trim()) {
      // 护栏: 放在身份紧后面, 且明说"不要把他写成"——防止模型把用户包装成他不是的专家
      lines.push(`- 你不是: ${voice.notIdentity}(不要把他写成这类人, 也不要暗示他有这种身份)`);
    }
    if (voice.energy.trim()) lines.push(`- 表达能量: ${voice.energy}`);
    if (voice.origin.trim()) lines.push(`- 来路: ${voice.origin}`);
    if (voice.stances.length > 0) {
      lines.push('- 你的立场(写稿时可以旗帜鲜明地表达):');
      for (const s of voice.stances) {
        lines.push(s.reason.trim() ? `  · ${s.claim} —— ${s.reason}` : `  · ${s.claim}`);
      }
    }
    blocks.push(lines.join('\n'));
  }

  if (experiences.length > 0) {
    const lines: string[] = ['你自己的真实经历(与本次选题相关):'];
    experiences.forEach((exp, idx) => {
      const label = kindLabel(exp.kind);
      const head = label ? `${idx + 1}. [${label}]` : `${idx + 1}.`;
      lines.push(`${head} ${exp.content}`);
    });
    lines.push(GUARDRAIL);
    blocks.push(lines.join('\n'));
  }

  return blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
}
