import type { DouyinSection } from "./script-mapping";

/**
 * 抽屉懒加载拉回改稿 UI 的窄化解析 —— 输入是 `GET /api/v1/scripts/{id}` 返回的
 * `ScriptDraft.output` (Json 字段, 落库形状见 `POST /api/v1/scripts/generate`
 * douyin 分支: `{ research, script: { sections }, hooks, titles, cover, durationSec }`,
 * `POST /api/v1/scripts/{id}/refine` 会整体替换 `script.sections`、其余键原样保留)。
 *
 * 单测覆盖三类场景 (见 tests/lib/cockpit/draft-restore.test.ts):
 * - 完整五期形态 → 五个字段都解析出来
 * - 旧形态 (五期以前只有 retentionBeats, 没有 script.sections) → 整体返回 null,
 *   抽屉保持现状不渲染分块面板 (没有 sections 就没有可编辑的改稿 UI)
 * - 畸形/单键缺失不炸: sections 合法即可返回, 其余字段各自独立解析、失败就不
 *   出现在返回对象的 key 里 (不是 undefined 值), 不影响其它字段和 sections 本身
 *   —— 与 script-mapping.ts 的 per-field 独立解析风格保持一致。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidSection(value: unknown): value is DouyinSection {
  return (
    isPlainObject(value) &&
    typeof value.role === "string" &&
    typeof value.startSec === "number" &&
    typeof value.endSec === "number" &&
    isNonEmptyString(value.text)
  );
}

function parseSections(raw: unknown): DouyinSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const sections = raw
    .filter(isValidSection)
    .map((s) => ({ role: s.role, startSec: s.startSec, endSec: s.endSec, text: s.text }));
  return sections.length > 0 ? sections : undefined;
}

export interface RestoredResearchPoint {
  fact: string;
  source: string;
  usage: string;
}

export interface RestoredResearch {
  points: RestoredResearchPoint[];
}

function isResearchPoint(value: unknown): value is RestoredResearchPoint {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.fact) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.usage)
  );
}

function parseResearch(raw: unknown): RestoredResearch | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.points)) return undefined;
  const points = raw.points.filter(isResearchPoint);
  return points.length > 0 ? { points } : undefined;
}

export interface RestoredHook {
  text: string;
}

function isHookCandidate(value: unknown): value is RestoredHook {
  return isPlainObject(value) && isNonEmptyString(value.text);
}

function parseHooks(raw: unknown): RestoredHook[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const hooks = raw.filter(isHookCandidate).map((h) => ({ text: h.text }));
  return hooks.length > 0 ? hooks : undefined;
}

// titles 目前在 content-drawer.tsx 里没有消费点 (没有标题候选切换 UI, headline
// 已经通过 item.script.headline 持久化), 这里仍然解析出来是为了 output 形状的
// 完整性——parseDraftOutput 对外承诺"能解析出 generate 响应里的哪些字段就带出
// 哪些", 不因调用方暂时不用某个字段就在解析层预先砍掉。小红书两阶段接入 (T6)
// 落库同样带 titles 数组时, 若届时抽屉需要标题候选 UI, 可以直接复用这里而不必
// 再补一遍窄化解析。
export interface RestoredTitle {
  text: string;
}

function isTitleCandidate(value: unknown): value is RestoredTitle {
  return isPlainObject(value) && isNonEmptyString(value.text);
}

function parseTitles(raw: unknown): RestoredTitle[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const titles = raw.filter(isTitleCandidate).map((t) => ({ text: t.text }));
  return titles.length > 0 ? titles : undefined;
}

const VALID_DURATIONS = [30, 45, 60] as const;
type DurationSec = (typeof VALID_DURATIONS)[number];

function parseDurationSec(raw: unknown): DurationSec | undefined {
  return typeof raw === "number" && (VALID_DURATIONS as readonly number[]).includes(raw)
    ? (raw as DurationSec)
    : undefined;
}

export interface ParsedDraftOutput {
  sections?: DouyinSection[];
  research?: RestoredResearch;
  hooks?: RestoredHook[];
  titles?: RestoredTitle[];
  durationSec?: DurationSec;
}

/**
 * @param output `ScriptDraft.output` 原始值 (未知形状)
 * @returns 解析出的改稿 UI 恢复字段；`script.sections` 解析不出合法块 (旧形态/
 *   完全畸形) 时返回 `null`——没有 sections 就没有可恢复的分块改稿 UI，调用方
 *   应静默保持现状，不覆盖抽屉已有的展示。
 */
export function parseDraftOutput(output: unknown): ParsedDraftOutput | null {
  if (!isPlainObject(output)) return null;

  const scriptField = output.script;
  const sections = isPlainObject(scriptField) ? parseSections(scriptField.sections) : undefined;
  if (!sections) return null;

  const result: ParsedDraftOutput = { sections };

  const research = parseResearch(output.research);
  if (research) result.research = research;

  const hooks = parseHooks(output.hooks);
  if (hooks) result.hooks = hooks;

  const titles = parseTitles(output.titles);
  if (titles) result.titles = titles;

  const durationSec = parseDurationSec(output.durationSec);
  if (durationSec !== undefined) result.durationSec = durationSec;

  return result;
}
