import { prisma } from '@/lib/prisma';
import type { StyleContext } from '@/lib/llm/prompts/script-write-douyin';

/**
 * 风格层 —「定稿即样本」积累路线。
 *
 * StyleProfile 没有 User 反向关系 (T1 裁决, 简报字面优先), 一律
 * `prisma.styleProfile.findUnique({ where: { userId } })` 直查, 不走 `user.styleProfile`。
 */

const RECENT_SAMPLE_COUNT = 3;
const SAMPLES_MODE_THRESHOLD = 2;

/** 纯函数: 样本总数 <2 用风格说明兜底, ≥2 切换为最近样本 few-shot。 */
export function pickStyleMode(sampleCount: number): 'description' | 'samples' {
  return sampleCount >= SAMPLES_MODE_THRESHOLD ? 'samples' : 'description';
}

export async function getStyleContext(userId: string, platform: string): Promise<StyleContext> {
  const [profile, recentSamples, totalCount] = await Promise.all([
    prisma.styleProfile.findUnique({ where: { userId } }),
    prisma.styleSample.findMany({
      where: { userId, platform },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SAMPLE_COUNT,
    }),
    prisma.styleSample.count({ where: { userId, platform } }),
  ]);

  return {
    mode: pickStyleMode(totalCount),
    description: profile?.description ?? '',
    samples: recentSamples.map((s) => s.content),
  };
}

/** 防御性解析 ScriptDraft.output(unknown Json) → script.sections[].text[]; 形状不对一律返回 null。 */
function extractSectionTexts(output: unknown): string[] | null {
  if (!output || typeof output !== 'object') return null;
  const script = (output as Record<string, unknown>).script;
  if (!script || typeof script !== 'object') return null;
  const sections = (script as Record<string, unknown>).sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;

  const texts: string[] = [];
  for (const section of sections) {
    if (!section || typeof section !== 'object' || typeof (section as { text?: unknown }).text !== 'string') {
      return null;
    }
    texts.push((section as { text: string }).text);
  }
  return texts;
}

/**
 * 定稿(或改稿后再定稿)时沉淀/刷新一条风格样本。
 *
 * 同一 sourceScriptDraftId 已有样本时**覆盖更新其 content**为最新 sections 拼接文本
 * (而非跳过) —— refine 改稿后再次定稿要让样本跟着最新文本走, 不冻结在初稿。
 * 不会为同一 scriptDraftId 产生重复条目。
 *
 * 返回值语义: 本次是否真的写入了(新建或覆盖) StyleSample; 无 sections 或草稿不属于
 * 该用户时返回 false, 不做任何写入。
 */
export async function depositStyleSample(userId: string, scriptDraftId: string): Promise<boolean> {
  const draft = await prisma.scriptDraft.findFirst({ where: { id: scriptDraftId, userId } });
  if (!draft) return false;

  const sectionTexts = extractSectionTexts(draft.output);
  if (!sectionTexts) return false;

  const content = sectionTexts.join('\n');
  const existing = await prisma.styleSample.findFirst({
    where: { userId, sourceScriptDraftId: scriptDraftId },
  });

  if (existing) {
    await prisma.styleSample.update({ where: { id: existing.id }, data: { content } });
    return true;
  }

  await prisma.styleSample.create({
    data: {
      userId,
      platform: draft.platform,
      content,
      sourceScriptDraftId: scriptDraftId,
    },
  });
  return true;
}
