/**
 * 创作者中心「作品管理」用的 work_list: 每条作品带完播/跳出/平均观看等指标, 老作品也有。
 * items[i].id 是超出 JS 精度的数字(会被改写), 不能用 —— 按下标与同页 aweme_list[i] 配对取 aweme_id, create_time 核对。
 */
export const WORK_LIST_MAX_PAGES = 15;

export interface WorkMetrics {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  favoriteCount: number | null;
  subscribeCount: number | null;
  homepageVisitCount: number | null;
  completionRate: number | null;
  completionRate5s: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
  avgViewProportion: number | null;
  fanViewProportion: number | null;
  metricsUpdatedAt: Date | null;
}

export interface WorkMetricRow {
  awemeId: string;
  createTime: number;
  metrics: WorkMetrics;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const int = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

function toMetrics(item: Obj): WorkMetrics {
  const m = obj(item.metrics);
  const upd = num(item.metrics_offline_update_time);
  return {
    viewCount: int(m.view_count),
    likeCount: int(m.like_count),
    commentCount: int(m.comment_count),
    shareCount: int(m.share_count),
    favoriteCount: int(m.favorite_count),
    subscribeCount: int(m.subscribe_count),
    homepageVisitCount: int(m.homepage_visit_count),
    completionRate: num(m.completion_rate),
    completionRate5s: num(m.completion_rate_5s),
    bounceRate2s: num(m.bounce_rate_2s),
    avgViewSec: num(m.avg_view_second),
    avgViewProportion: num(m.avg_view_proportion),
    fanViewProportion: num(m.fan_view_proportion),
    metricsUpdatedAt: upd ? new Date(upd * 1000) : null,
  };
}

export function pairWorkListPage(page: unknown): { rows: WorkMetricRow[]; skipped: number; hasMore: boolean; maxCursor: number } {
  const p = obj(page);
  const aw = Array.isArray(p.aweme_list) ? p.aweme_list.map(obj) : [];
  const items = Array.isArray(p.items) ? p.items.map(obj) : [];
  const rows: WorkMetricRow[] = [];
  let skipped = 0;
  items.forEach((it, i) => {
    const a = aw[i];
    const awemeId = a && typeof a.aweme_id === 'string' ? a.aweme_id : '';
    if (!awemeId || num(a.create_time) !== num(it.create_time)) {
      skipped++;
      return;
    }
    rows.push({ awemeId, createTime: num(a.create_time) ?? 0, metrics: toMetrics(it) });
  });
  return { rows, skipped, hasMore: p.has_more === true || p.has_more === 1, maxCursor: num(p.max_cursor) ?? 0 };
}

/**
 * 在已登录的创作者中心页面里翻 work_list, 每页只保留配对需要的字段(不在浏览器里用 items[].id)。
 * 输出 @@RESULT@@ + 裁剪页数组。只读。
 */
export const WORK_LIST_SCRIPT = `
const task = await taskSpace('抖音账号资料')
const p = task.page('p1')
await p.goto('https://creator.douyin.com/creator-micro/content/manage', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 4000))
const pages = []
let cursor = 0
for (let i = 0; i < ${WORK_LIST_MAX_PAGES}; i++) {
  const r = await p.fetch('https://creator.douyin.com/janus/douyin/creator/pc/work_list?status=0&count=12&max_cursor=' + cursor + '&scene=star_atlas&device_platform=android&aid=1128', { credentials: 'include', timeout: 20000 })
  if (r.status !== 200) throw new Error('work_list HTTP ' + r.status)
  const d = JSON.parse(r.body)
  if (d.status_code !== 0) throw new Error('work_list status_code ' + d.status_code)
  pages.push({
    has_more: d.has_more,
    max_cursor: d.max_cursor,
    aweme_list: (d.aweme_list || []).map((a) => ({ aweme_id: a.aweme_id, create_time: a.create_time })),
    items: (d.items || []).map((it) => ({ create_time: it.create_time, metrics: it.metrics, metrics_offline_update_time: it.metrics_offline_update_time })),
  })
  if (!d.has_more) break
  cursor = d.max_cursor
  await new Promise((r) => setTimeout(r, 1000))
}
cliLog('@@RESULT@@' + JSON.stringify(pages))
`;
