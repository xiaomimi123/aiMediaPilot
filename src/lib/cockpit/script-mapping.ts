import type { ScriptDraft } from "@/lib/cockpit/model";
import type { ContentPlatform } from "@/lib/platform";

/**
 * 三平台生成结果 → 脚本骨架 (ScriptDraft) 映射纯函数。
 *
 * - 纯函数：无 fetch / prisma，只依赖 ScriptDraft 类型。
 * - `result` 是未知形状（LLM 生成响应，可能残缺/畸形），因此做窄化解析而非
 *   信任完整 zod schema —— 单个字段解析失败不影响其它字段（per-field 独立）。
 * - 返回 `Partial<ScriptDraft>`：source 缺失的字段【不作为 key 出现】
 *   （不是 `undefined` 值），因为调用方会把返回结果 spread 到已有用户内容上，
 *   一个 `undefined` 的 key 会把用户已写的文本覆盖成 undefined。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// douyin: hooks[{text,rationale}] / retentionBeats[{startSec,endSec,beat}] /
//         titles[{text,hookType}] / cover{textOverlay,shotIdea,colorTone}
// ---------------------------------------------------------------------------
function mapDouyin(result: Record<string, unknown>): Partial<ScriptDraft> {
  const draft: Partial<ScriptDraft> = {};

  const titles = result.titles;
  if (Array.isArray(titles) && titles.length > 0) {
    const first = titles[0];
    if (isPlainObject(first) && isNonEmptyString(first.text)) {
      draft.headline = first.text;
    }
  }

  const hooks = result.hooks;
  if (Array.isArray(hooks) && hooks.length > 0) {
    const first = hooks[0];
    if (isPlainObject(first) && isNonEmptyString(first.text)) {
      const rationale = isNonEmptyString(first.rationale) ? first.rationale : undefined;
      draft.hook = rationale ? `${first.text}\n// ${rationale}` : first.text;
    }
  }

  const beats = result.retentionBeats;
  if (Array.isArray(beats) && beats.length > 0) {
    const lines = beats
      .filter(
        (beat): beat is { startSec: number; endSec: number; beat: string } =>
          isPlainObject(beat) &&
          typeof beat.startSec === "number" &&
          typeof beat.endSec === "number" &&
          isNonEmptyString(beat.beat)
      )
      .map((beat) => `${beat.startSec}-${beat.endSec}s：${beat.beat}`);
    if (lines.length > 0) {
      draft.body = lines.join("\n");
    }
  }

  const cover = result.cover;
  if (
    isPlainObject(cover) &&
    isNonEmptyString(cover.textOverlay) &&
    isNonEmptyString(cover.shotIdea) &&
    isNonEmptyString(cover.colorTone)
  ) {
    draft.example = `封面文字：${cover.textOverlay}\n镜头创意：${cover.shotIdea}\n色调：${cover.colorTone}`;
  }

  return draft;
}

// ---------------------------------------------------------------------------
// xiaohongshu: titles / coverText / intro / body / tags[] / shotIdeas[{idx,description}]
// ---------------------------------------------------------------------------
function mapXiaohongshu(result: Record<string, unknown>): Partial<ScriptDraft> {
  const draft: Partial<ScriptDraft> = {};

  const titles = result.titles;
  if (Array.isArray(titles) && titles.length > 0) {
    const first = titles[0];
    if (isPlainObject(first) && isNonEmptyString(first.text)) {
      draft.headline = first.text;
    }
  }

  if (isNonEmptyString(result.intro)) {
    draft.hook = result.intro;
  }

  if (isNonEmptyString(result.coverText)) {
    draft.conclusion = result.coverText;
  }

  if (isNonEmptyString(result.body)) {
    draft.body = result.body;
  }

  const shotIdeas = result.shotIdeas;
  if (Array.isArray(shotIdeas) && shotIdeas.length > 0) {
    const lines = shotIdeas
      .filter(
        (idea): idea is { idx: number; description: string } =>
          isPlainObject(idea) && typeof idea.idx === "number" && isNonEmptyString(idea.description)
      )
      .sort((a, b) => a.idx - b.idx)
      .map((idea) => `${idea.idx}. ${idea.description}`);
    if (lines.length > 0) {
      draft.example = lines.join("\n");
    }
  }

  const tags = result.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const validTags = tags.filter(isNonEmptyString);
    if (validTags.length > 0) {
      draft.ending = validTags.map((tag) => `#${tag}`).join(" ");
    }
  }

  return draft;
}

// ---------------------------------------------------------------------------
// gongzhonghao: titles / abstract / outline[] / body / cta
// ---------------------------------------------------------------------------
function mapGongzhonghao(result: Record<string, unknown>): Partial<ScriptDraft> {
  const draft: Partial<ScriptDraft> = {};

  const titles = result.titles;
  if (Array.isArray(titles) && titles.length > 0) {
    const first = titles[0];
    if (isPlainObject(first) && isNonEmptyString(first.text)) {
      draft.headline = first.text;
    }
  }

  if (isNonEmptyString(result.abstract)) {
    draft.hook = result.abstract;
  }

  const outline = result.outline;
  const validOutline = Array.isArray(outline) ? outline.filter(isNonEmptyString) : [];
  const hasBody = isNonEmptyString(result.body);
  if (validOutline.length > 0 && hasBody) {
    const numbered = validOutline.map((item, idx) => `${idx + 1}. ${item}`).join("\n");
    draft.body = `${numbered}\n\n${result.body}`;
  }

  if (isNonEmptyString(result.cta)) {
    draft.ending = result.cta;
  }

  return draft;
}

/**
 * 三平台生成结果 → 脚本骨架 (ScriptDraft) 映射。
 *
 * @param platform 生成来源平台
 * @param result 生成响应（未知形状，来自 LLM，可能残缺/畸形）
 * @returns 仅包含成功解析字段的 Partial<ScriptDraft>；缺失/无法解析的字段完全不作为 key 出现。
 */
export function mapGeneratedToScript(platform: ContentPlatform, result: unknown): Partial<ScriptDraft> {
  if (!isPlainObject(result)) {
    return {};
  }

  switch (platform) {
    case "douyin":
      return mapDouyin(result);
    case "xiaohongshu":
      return mapXiaohongshu(result);
    case "gongzhonghao":
      return mapGongzhonghao(result);
    default:
      return {};
  }
}
