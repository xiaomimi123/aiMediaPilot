import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_WRITE_DOUYIN, buildTemplateSection } from '@/lib/llm/prompts/script-write-douyin';
import { getStyleContext } from '@/lib/script/style';
import { allocateActSeconds } from '@/lib/script/six-act';
import { runResearch } from '@/lib/script/research';
import { loadPersonaProfile } from '@/lib/persona/profile';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import { buildVoiceSection } from '@/lib/llm/prompts/voice-section';
import { loadCreatorVoice, loadExperiences } from '@/lib/persona/voice';
import { matchExperiences } from '@/lib/persona/experience-match';

// niche 硬编码 'ai-knowledge': 产品当前只服务 AI 知识赛道创作者 (同 persona/draft、
// experiences、voice/draft 等路由先例), 模板出稿请求体里也没有 niche 字段可取。
const DEFAULT_NICHE = 'ai-knowledge';

/**
 * 模板页文案生成(二十期): 粘贴的一段文字 / 一条灵感 → 按模板写稿提示产出六幕稿。
 * **不落库** —— 用户在向导里确认后由 /produce 统一建卡, 避免"点了生成就冒出一堆
 * 半成品内容卡"污染内容总览。
 *
 * 人设定位(personaSection) + 人物志/经历(voiceSection) 的注入照搬
 * `/api/v1/scripts/generate` douyin 分支同一套逻辑 (见该文件 ~160-180 行) ——
 * 模板出稿与普通写稿必须共享同一个人格注入路径, 否则模板写出来的稿子没有人设。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { source?: unknown; text?: unknown; inspirationId?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }

  const user = await getOrCreateDefaultUser();
  const template = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!template || template.userId !== user.id) return fail('模板不存在', 404);

  let topic: string;
  if (body.source === 'paste') {
    if (typeof body.text !== 'string' || body.text.trim().length < 5) {
      return fail('粘贴的文案太短, 至少 5 个字', 400);
    }
    topic = body.text.trim();
  } else if (body.source === 'inspiration') {
    if (typeof body.inspirationId !== 'string') return fail('缺少 inspirationId', 400);
    const insp = await prisma.cockpitInspiration.findUnique({ where: { id: body.inspirationId } });
    if (!insp || insp.userId !== user.id) return fail('灵感不存在', 404);
    topic = insp.text;
  } else {
    return fail('source 必须是 paste 或 inspiration', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 400);

  const scriptPrompt = (template.scriptPrompt ?? null) as
    | { tone?: string; targetDurationSec?: 30 | 45 | 60 | 90; hookHint?: string; extraGuidance?: string }
    | null;
  const durationSec = scriptPrompt?.targetDurationSec ?? 90;
  const style = await getStyleContext(user.id, 'douyin');

  // 与 /scripts/generate douyin 分支同一套人格注入: 经历检索 → 人设定位 → 人物志。
  // 模板出稿请求体没有 intent 字段, buildPersonaSection 的 intent 传 undefined ——
  // 语义等价于 /scripts/generate 未传 intent 时 validateIntent('') 得到的 '' (两者
  // 都不追加 CTA 指引段), 不改变有档案时的其余段落输出。
  const matchedExperiences = matchExperiences(topic, await loadExperiences(user.id), 3);
  const profile = await loadPersonaProfile(user.id);
  const personaSection = buildPersonaSection(profile, 'write');
  const voice = await loadCreatorVoice(user.id);
  const voiceSection = buildVoiceSection(voice, matchedExperiences);

  // 二十一期: 模板写稿原本 brief 恒为 null —— 手上没有带来源的真实事实点, 画面层
  // 只能画抽象图形, 这正是成片"没有实感"的源头(见参考视频拆解 §2.1)。开了研究的
  // 模板先跑一次 Tavily 采集素材; runResearch 内部已 fail-soft, 失败返回 null 不阻断出稿。
  // 搜索词只取首行标题, 正文整段当素材 —— 真实出片踩过: 灵感文本是"标题/角度/摘要/URL"
  // 四行拼在一起的一整段, 整段丢给 Tavily 当查询词搜不到任何东西, 素材池空 → 研究降级。
  // 而那段摘要本身就是带来源的真实素材(日期/倍数/融资额/出处俱全), 白白浪费了。
  const searchTopic = topic.split('\n')[0].trim() || topic;
  const research = template.researchEnabled
    ? await runResearch(user.id, {
        topic: searchTopic,
        niche: DEFAULT_NICHE,
        userMaterials: topic,
        experiences: [],
      })
    : null;

  const llm = getDeepSeekTextLLM(apiKey);
  const { result } = await llm.callStructured({
    systemPrompt: SCRIPT_WRITE_DOUYIN.buildSystemPrompt(
      DEFAULT_NICHE, style, personaSection, voiceSection, buildTemplateSection(scriptPrompt),
    ),
    userMessage: SCRIPT_WRITE_DOUYIN.buildUserMessage({
      topic,
      durationSec,
      brief: research,
      actSeconds: allocateActSeconds(durationSec),
    }),
    responseSchema: SCRIPT_WRITE_DOUYIN.responseSchema,
  });

  // 简报随响应返回: 前端能展示"这稿子基于哪些素材", 降级时也如实标出来而不是假装有料
  return ok({ script: result, research, researchDegraded: research === null });
}
