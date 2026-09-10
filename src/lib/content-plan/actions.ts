/**
 * 三十八期 Task 3: 「今天打开就有活干」的联动动作 —— 纯 fetch 封装, 客户端 import
 * (供 T5 的今日卡按钮调用)。每个函数做两步: 调现有生成/出片接口 → 成功后
 * PATCH 回填 ContentPlanDay 状态。
 *
 * 两步不是一个原子操作: 生成/出片成功了但 PATCH 失败(网络抖动/并发写冲突)不能让
 * 结果消失或让调用方卡死 —— 返回 `syncFailed: true` 而不是吞掉或抛错, 让今日卡
 * 显示「已生成但状态没记上, 点此重试」, 调用方拿着已经到手的 id 就能重试 PATCH。
 */

export interface ContentPlanDayLite {
  topic: string;
  angle: string;
  hookDirection: string;
}

export type GenerateTodayScriptResult =
  | { ok: true; scriptDraftId: string; syncFailed: boolean }
  | { ok: false; message: string };

export type ProduceTodayResult =
  | { ok: true; videoProductionId: string; syncFailed: boolean }
  | { ok: false; message: string };

async function readJson(res: Response): Promise<{ success?: boolean; data?: Record<string, unknown>; message?: string } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function patchDay(
  planId: string,
  dayIndex: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/content-plans/${planId}/days/${dayIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 今日卡「生成今日脚本」: 调 `/api/v1/scripts/generate`(六幕全稿, douyin/ai-knowledge
 * 固定, 时长照默认 60s, materials 把角度+钩子方向一并带过去当写稿素材)→ 成功后
 * PATCH `mark-scripted` 回填 scriptDraftId。
 */
export async function generateTodayScript(input: {
  planId: string;
  dayIndex: number;
  day: ContentPlanDayLite;
}): Promise<GenerateTodayScriptResult> {
  const res = await fetch('/api/v1/scripts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: input.day.topic,
      niche: 'ai-knowledge',
      platform: 'douyin',
      durationSec: 60,
      mode: 'full',
      materials: `角度: ${input.day.angle}；钩子方向: ${input.day.hookDirection}`,
    }),
  });
  const json = await readJson(res);
  const scriptDraftId = json?.data?.scriptDraftId;
  if (!res.ok || !json?.success || typeof scriptDraftId !== 'string' || !scriptDraftId) {
    return { ok: false, message: json?.message ?? `生成失败(HTTP ${res.status})` };
  }

  const synced = await patchDay(input.planId, input.dayIndex, {
    action: 'mark-scripted',
    scriptDraftId,
  });

  return { ok: true, scriptDraftId, syncFailed: !synced };
}

/**
 * 今日卡「用模板出片」: 调 `/api/v1/video-templates/[id]/produce`(body 只带
 * scriptDraftId —— 走既有的按稿复用分支)→ 成功后 PATCH `mark-produced` 回填
 * videoProductionId。
 */
export async function produceToday(input: {
  templateId: string;
  scriptDraftId: string;
  planId: string;
  dayIndex: number;
}): Promise<ProduceTodayResult> {
  const res = await fetch(`/api/v1/video-templates/${input.templateId}/produce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptDraftId: input.scriptDraftId }),
  });
  const json = await readJson(res);
  const videoProductionId = json?.data?.videoProductionId;
  if (!res.ok || !json?.success || typeof videoProductionId !== 'string' || !videoProductionId) {
    return { ok: false, message: json?.message ?? `出片失败(HTTP ${res.status})` };
  }

  const synced = await patchDay(input.planId, input.dayIndex, {
    action: 'mark-produced',
    videoProductionId,
  });

  return { ok: true, videoProductionId, syncFailed: !synced };
}
