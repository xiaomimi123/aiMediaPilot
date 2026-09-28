import { EgoUnavailableError, readResult, runEgo } from '@/lib/ego';
import { DouyinLoginError, DouyinRejectedError, parseDetail, parseProfile, parseUserSearch, parseWorks, type ParsedProfile, type ParsedWork } from './parse';

/**
 * 抖音只读访问(ego lite 默认配置 = 用户大号, 2026-09-28 授权只读低频)。
 * 规矩: 这里只允许 GET 读取接口。任何点赞/关注/评论/收藏/私信接口都不得出现 —— 测试用 WRITE_PATTERNS 守门。
 * 所有请求在博主主页/首页里用 page.fetch 发出(带登录 cookie, 实测不需要签名参数)。
 */
export const WRITE_PATTERNS = /commit|digg\/|follow|favorite|collect\/|comment\/publish|im\/|method:\s*['"]POST/i;

/** 网页用的 ego 任务空间; 每晚巡检用 SCAN_SPACE, 两个进程不抢同一个页面 */
export const WEB_SPACE = '对标雷达';
export const SCAN_SPACE = '对标雷达-巡检';
const Q = 'device_platform=webapp&aid=6383&channel=channel_pc_web';

export type EgoRunner = (script: string) => Promise<string>;

export interface DouyinClient {
  fetchAccount(secUid: string): Promise<{ profile: ParsedProfile; works: ParsedWork[] }>;
  fetchDetail(awemeId: string): Promise<ParsedWork>;
  downloadVideo(awemeId: string, destPath: string): Promise<void>;
  searchUsers(keyword: string): Promise<ParsedProfile[]>;
}

function assertSecUid(s: string): string {
  if (!/^MS4w[\w-]+$/.test(s)) throw new Error(`不是合法的博主 id: ${s.slice(0, 40)}`);
  return s;
}
function assertAwemeId(s: string): string {
  if (!/^\d{8,}$/.test(s)) throw new Error(`不是合法的作品 id: ${s.slice(0, 40)}`);
  return s;
}

const head = (url: string, space: string) => `
const task = await taskSpace(${JSON.stringify(space)})
const p = task.page('p1')
await p.goto(${JSON.stringify(url)}, { timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
const get = async (u) => { const r = await p.fetch(u, { credentials: 'include', timeout: 20000 }); return { status: r.status, body: r.body } }
`;

export function buildAccountScript(secUid: string, space = WEB_SPACE): string {
  const sec = assertSecUid(secUid);
  return `${head(`https://www.douyin.com/user/${sec}`, space)}
const profile = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/user/profile/other/?${Q}&sec_user_id=${sec}`)})
await new Promise((r) => setTimeout(r, 2000))
const post = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/post/?${Q}&sec_user_id=${sec}&max_cursor=0&count=18`)})
cliLog('@@RESULT@@' + JSON.stringify({ profile, post }))
`;
}

export function buildDetailScript(awemeId: string, space = WEB_SPACE): string {
  const id = assertAwemeId(awemeId);
  return `${head('https://www.douyin.com/', space)}
cliLog('@@RESULT@@' + JSON.stringify(await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${Q}&aweme_id=${id}`)})))
`;
}

/** 播放地址会过期, 所以下载前现取详情; 逐个地址尝试 */
export function buildDownloadScript(awemeId: string, destPath: string, space = WEB_SPACE): string {
  const id = assertAwemeId(awemeId);
  return `${head('https://www.douyin.com/', space)}
const d = await get(${JSON.stringify(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${Q}&aweme_id=${id}`)})
let saved = false
let lastStatus = d.status
try {
  const urls = JSON.parse(d.body).aweme_detail.video.play_addr.url_list
  for (const u of urls) {
    const r = await p.fetch(u, { saveAs: ${JSON.stringify(destPath)}, timeout: 120000, referrer: 'https://www.douyin.com/' })
    lastStatus = r.status
    if (r.status === 200) { saved = true; break }
  }
} catch (e) { lastStatus = String(e).slice(0, 200) }
cliLog('@@RESULT@@' + JSON.stringify({ saved, lastStatus }))
`;
}

export function buildSearchScript(keyword: string, space = WEB_SPACE): string {
  const kw = JSON.stringify(keyword);
  return `${head('https://www.douyin.com/', space)}
await p.goto('https://www.douyin.com/search/' + encodeURIComponent(${kw}) + '?type=user', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
cliLog('@@RESULT@@' + JSON.stringify(await get('https://www.douyin.com/aweme/v1/web/discover/search/?${Q}&search_channel=aweme_user_web&search_source=normal_search&query_correct_type=1&is_filter_search=0&offset=0&count=10&keyword=' + encodeURIComponent(${kw}))))
`;
}

type Raw = { status: number; body: string };

function body(r: Raw): unknown {
  if (r.status !== 200) throw new DouyinRejectedError(`抖音拒绝了请求(HTTP ${r.status})`);
  try {
    return JSON.parse(r.body);
  } catch {
    throw new DouyinLoginError();
  }
}

export function createDouyinClient(run: EgoRunner = (s) => runEgo(s, 3 * 60_000), space = WEB_SPACE): DouyinClient {
  const exec = async (script: string) => {
    let output: string;
    try {
      output = await run(script);
    } catch (e) {
      throw new EgoUnavailableError('ego lite 没有响应：可能没打开，或抖音登录已过期。打开 ego lite 重新登录一次再试。', { cause: e });
    }
    return readResult(output);
  };
  return {
    async fetchAccount(secUid) {
      const r = (await exec(buildAccountScript(secUid, space))) as { profile: Raw; post: Raw };
      const profileJson = body(r.profile);
      const postJson = body(r.post) as { aweme_list?: unknown[] };
      const declared = Number((profileJson as { user?: { aweme_count?: unknown } }).user?.aweme_count) || 0;
      // 主页说有作品, 列表却是空的: 登录掉了时抖音就这样回, 不能当"这个号没作品"
      if (declared > 0 && Array.isArray(postJson.aweme_list) && postJson.aweme_list.length === 0) throw new DouyinLoginError();
      return { profile: parseProfile(profileJson), works: parseWorks(postJson).works };
    },
    async fetchDetail(awemeId) {
      return parseDetail(body((await exec(buildDetailScript(awemeId, space))) as Raw));
    },
    async downloadVideo(awemeId, destPath) {
      const r = (await exec(buildDownloadScript(awemeId, destPath, space))) as { saved: boolean; lastStatus: unknown };
      if (!r.saved) throw new DouyinRejectedError(`视频下载失败(${String(r.lastStatus)})`);
    },
    async searchUsers(keyword) {
      return parseUserSearch(body((await exec(buildSearchScript(keyword, space))) as Raw));
    },
  };
}
