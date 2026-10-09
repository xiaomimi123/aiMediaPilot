import { z } from 'zod';
import { DEFAULT_TARGET_SEC, type Script } from '@/lib/script/model';
import type { StructuredLLM, writeScript } from '@/lib/script/write';
import { findCopiedInScript, type CopiedRun } from '@/lib/benchmark/copy-check';
import type { ScriptPrediction } from '@/lib/predict/run';
import { loadPools, localDay, pickCandidates, type Candidate, type CandidateStore, type TopicSource } from './candidates';

export const TARGET_SEC = DEFAULT_TARGET_SEC;
export const NO_SOURCE_REASON = '没有可用的选题来源：加几个对标账号，或在点子池里写几句';

export const RECENT_HOURS = 6;
export const DUPLICATE_REASON = '这个选题刚被另一次运行生成过';

export function succeededRecently(successTimes: Date[], now: Date, hours = RECENT_HOURS): boolean {
  return successTimes.some((t) => now.getTime() - t.getTime() < hours * 3600_000);
}

/** 一个都没生成时: 没有来源、或都被另一次运行抢先生成了 → 算完成(补跑也没用); 其他(没模型、写稿都失败) → 失败, 等补跑 */
export function runOutcome(r: { created: number; skipped: { source?: TopicSource; reason: string }[] }): 'done' | 'failed' {
  if (r.created > 0) return 'done';
  return r.skipped.length > 0 && r.skipped.every((s) => s.reason === NO_SOURCE_REASON || s.reason === DUPLICATE_REASON) ? 'done' : 'failed';
}

/** kind / checklist / questions 宽松接收(格式不对就当没有), 不能因为问题写坏了丢掉整个选题 */
export const TopicPlanSchema = z.object({ title: z.string().min(1), why: z.string().min(1), hook: z.string().min(1), direction: z.string().min(10), kind: z.string().optional(), checklist: z.unknown().optional(), questions: z.unknown().optional() });
export const ChecklistSchema = z.array(z.object({ test: z.string().min(1), record: z.string().min(1) })).min(1).max(6);
export type ChecklistItem = z.infer<typeof ChecklistSchema>[number];
export type TopicPlan = { title: string; why: string; hook: string; direction: string; questions: string[] };
export const MAX_QUESTIONS = 6;

/** 实测清单的一项转成一个问题(旧数据读取时也用) */
export const checklistQuestion = (c: ChecklistItem) => `实测：${c.test}，记下：${c.record}`;

export function normalizePlan(raw: unknown): TopicPlan {
  const p = TopicPlanSchema.parse(raw);
  const asked = z.array(z.string()).safeParse(p.questions);
  const list = p.kind === 'test' ? ChecklistSchema.safeParse(p.checklist) : null;
  const all = [...(asked.success ? asked.data : []), ...(list?.success ? list.data.map(checklistQuestion) : [])].map((q) => q.trim()).filter(Boolean);
  return { title: p.title, why: p.why, hook: p.hook, direction: p.direction, questions: [...new Set(all)].slice(0, MAX_QUESTIONS) };
}

const PLAN_SYSTEM = `你是抖音 AI 知识类博主的编导，根据给你的一条素材定一个今天能做的选题。
- 只基于素材和账号定位，不编"最近很火的XX"这类素材里没有的热点，不编数字。
- 对标素材：借选题和角度，换成博主自己的经历和视角，不照抄原话。
- 续集素材：接着原片结尾留下的话头讲，或把原片里最受欢迎的点展开。
- 点子素材：把博主的一句话点子展开成能讲 60–90 秒的选题。
- direction 里不要写任何测试结果、亲身经历或数字（素材里没有的一律不写）；实测类选题写成「要实测什么、记下哪几项结果」，结果留给博主自己测。
- questions（3–5 个）：问博主能讲成故事的真事，好让他用自己的话答——数量（收藏了多少个）、具体是哪个（哪个工具、哪个人）、哪一次（第一次、翻车那次）、当时什么感受。每个问题一句口语，具体，能几句话答完。
- kind：需要博主亲手测了才能讲的（对比、实测、试用）填 "test"，讲观点或经历的填 "talk"。
- checklist（只有 test 才写，2–5 项）：每项 {"test": "要测什么（具体动作）", "record": "记下什么（具体结果）"}，让博主照着测。
- title：选题标题（20 字内）；why：为什么值得做（一句）；hook：开头钩子（一句口语）；direction：给写稿的方向说明（讲什么、什么角度、用什么例子）。
只输出 JSON：{"title": "", "why": "", "hook": "", "direction": "", "questions": [], "kind": "talk", "checklist": []}`;

const SOURCE_LABEL: Record<TopicSource, string> = { benchmark: '对标', sequel: '续集', idea: '点子' };

export interface NewDailyTopic {
  day: string;
  source: TopicSource;
  sourceId: string;
  title: string;
  why: string;
  hook: string;
  direction: string;
  script: Script;
  copied: CopiedRun[];
  prediction: ScriptPrediction | null;
  /** 要问博主的问题(含实测项) */
  questions: string[];
}

export interface GenDeps {
  llm: StructuredLLM | null;
  noModelReason: string;
  now: Date;
  store: CandidateStore;
  personaText: string;
  lessons: string | undefined;
  /** 说话样本(最近几篇用户自己写的口播) */
  samples: string[];
  write: typeof writeScript;
  predict(script: Script, benchmarkVideoId: string | undefined): Promise<ScriptPrediction | null>;
  save(t: NewDailyTopic): Promise<'saved' | 'duplicate'>;
  markIdeaUsed(id: string): Promise<void>;
  recordRun(r: { day: string; created: number; skipped: { source?: TopicSource; reason: string }[] }): Promise<void>;
  /** 最近 6 小时内有过成功的生成(按时间算, 不按日历天: 23:00 成功后 0:00、1:00 的补跑要跳过) */
  doneRecently(now: Date): Promise<boolean>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function generateDailyTopics(d: GenDeps, opts: { scheduled?: boolean } = {}) {
  const day = localDay(d.now);
  if (opts.scheduled && (await d.doneRecently(d.now))) return { created: 0, skipped: [], alreadyDone: true };
  const skipped: { source?: TopicSource; reason: string }[] = [];
  let created = 0;
  const finish = async () => {
    await d.recordRun({ day, created, skipped });
    return { created, skipped, alreadyDone: false };
  };
  if (!d.llm) {
    skipped.push({ reason: d.noModelReason });
    return finish();
  }
  const picks = pickCandidates(await loadPools(d.store, d.now));
  if (!picks.length) {
    skipped.push({ reason: NO_SOURCE_REASON });
    return finish();
  }
  for (const c of picks) {
    const r = await oneTopic(d, d.llm, c, day).catch((e: unknown) => ({ error: msg(e) }));
    if ('error' in r) skipped.push({ source: c.source, reason: r.error });
    else created++;
  }
  return finish();
}

async function oneTopic(d: GenDeps, llm: StructuredLLM, c: Candidate, day: string): Promise<{ ok: true } | { error: string }> {
  let plan: TopicPlan;
  try {
    const { result } = await llm.callStructured({
      systemPrompt: PLAN_SYSTEM,
      userMessage: [{ type: 'text', text: `【账号定位】\n${d.personaText || '（未填写）'}\n\n【素材（${SOURCE_LABEL[c.source]}）】\n${c.material}` }],
      responseSchema: TopicPlanSchema,
    });
    plan = normalizePlan(result);
  } catch (e) {
    return { error: `定选题失败：${msg(e).slice(0, 80)}` };
  }
  let script: Script;
  try {
    script = (await d.write({ llm, direction: `${plan.title}。${plan.direction}\n开头钩子：${plan.hook}`, targetSec: TARGET_SEC, personaText: d.personaText, reference: c.reference, lessons: d.lessons, samples: d.samples, facts: c.material })).script;
  } catch (e) {
    return { error: `写稿失败：${msg(e)}` };
  }
  const copied = c.reference ? findCopiedInScript(script, c.reference) : [];
  const prediction = await d.predict(script, c.benchmarkVideoId).catch(() => null);
  const saved = await d.save({ day, source: c.source, sourceId: c.sourceId, ...plan, script, copied, prediction });
  if (saved === 'duplicate') return { error: DUPLICATE_REASON };
  if (c.source === 'idea') await d.markIdeaUsed(c.sourceId);
  return { ok: true };
}

/** 用户答了问题后重写: 只把答了的问答交给编导(没答的不进去, 稿子里仍留【待补】); 带说话样本; 重新预测 */
export async function rewriteWithAnswers(
  d: Pick<GenDeps, 'llm' | 'noModelReason' | 'write' | 'predict' | 'personaText' | 'lessons' | 'samples'>,
  t: { title: string; hook: string; direction: string; source: string; sourceId: string; questions: string[] },
  answers: string[],
): Promise<{ script: Script; prediction: ScriptPrediction | null }> {
  const answered = t.questions.map((q, i) => ({ q, a: (answers[i] ?? '').trim() })).filter((x) => x.a);
  if (!answered.length) throw new Error('先答至少一个问题');
  if (!d.llm) throw new Error(d.noModelReason);
  const { script } = await d.write({ llm: d.llm, direction: `${t.title}。${t.direction}\n开头钩子：${t.hook}`, targetSec: TARGET_SEC, personaText: d.personaText, lessons: d.lessons, samples: d.samples, answers: answered });
  const prediction = await d.predict(script, t.source === 'benchmark' ? t.sourceId : undefined).catch(() => null);
  return { script, prediction };
}
