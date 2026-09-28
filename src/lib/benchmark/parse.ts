/**
 * 抖音网页接口 JSON → 本项目的结构。字段来自 2026-09-28 真实返回(见 tests/fixtures/douyin)。
 * 他人作品的 play_count 恒为 0, 不取。
 */
export class DouyinRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DouyinRejectedError';
  }
}

export interface ParsedWork {
  awemeId: string;
  desc: string;
  url: string;
  publishedAt: Date;
  durationSec: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
  isTop: boolean;
  playUrls: string[];
  authorSecUid: string;
  authorName: string;
}

export interface ParsedProfile {
  secUid: string;
  nickname: string;
  douyinId: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  totalLikes: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function envelope(json: unknown): Obj {
  const d = obj(json);
  if (d.status_code !== 0) throw new DouyinRejectedError(`抖音接口返回异常(status_code=${String(d.status_code ?? '无')})`);
  return d;
}

function toWork(raw: unknown): ParsedWork | null {
  const a = obj(raw);
  const playUrls = (obj(obj(a.video).play_addr).url_list as unknown[] | undefined)?.filter((u): u is string => typeof u === 'string') ?? [];
  // 图文作品(aweme_type 68 / 带 images)没有视频, 无法转写
  if (a.images || playUrls.length === 0) return null;
  const s = obj(a.statistics);
  const author = obj(a.author);
  const id = str(a.aweme_id);
  if (!id) return null;
  return {
    awemeId: id,
    desc: str(a.desc),
    url: `https://www.douyin.com/video/${id}`,
    publishedAt: new Date(num(a.create_time) * 1000),
    durationSec: Math.round(num(a.duration) / 1000),
    digg: num(s.digg_count),
    comment: num(s.comment_count),
    collect: num(s.collect_count),
    share: num(s.share_count),
    isTop: a.is_top === 1 || a.is_top === true,
    playUrls,
    authorSecUid: str(author.sec_uid),
    authorName: str(author.nickname),
  };
}

export function parseWorks(json: unknown): { works: ParsedWork[]; hasMore: boolean } {
  const d = envelope(json);
  if (!Array.isArray(d.aweme_list)) throw new DouyinRejectedError('抖音接口没有返回作品列表');
  return { works: d.aweme_list.map(toWork).filter((w): w is ParsedWork => w !== null), hasMore: d.has_more === 1 || d.has_more === true };
}

export function parseDetail(json: unknown): ParsedWork {
  const w = toWork(envelope(json).aweme_detail);
  if (!w) throw new DouyinRejectedError('这条作品不是视频，或已删除、不可见');
  return w;
}

function toProfile(raw: unknown): ParsedProfile {
  const u = obj(raw);
  const uid = str(u.unique_id);
  const short = str(u.short_id);
  return {
    secUid: str(u.sec_uid),
    nickname: str(u.nickname),
    douyinId: uid || (short && short !== '0' ? short : ''),
    avatarUrl: str((obj(u.avatar_thumb).url_list as unknown[] | undefined)?.[0]),
    bio: str(u.signature),
    followers: num(u.follower_count),
    totalLikes: num(u.total_favorited),
  };
}

export function parseProfile(json: unknown): ParsedProfile {
  const p = toProfile(envelope(json).user);
  if (!p.secUid) throw new DouyinRejectedError('抖音接口没有返回博主资料');
  return p;
}

export function parseUserSearch(json: unknown): ParsedProfile[] {
  const d = envelope(json);
  const list = Array.isArray(d.user_list) ? d.user_list : [];
  return list.map((x) => toProfile(obj(x).user_info)).filter((p) => p.secUid && p.nickname);
}
