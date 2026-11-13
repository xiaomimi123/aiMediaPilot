import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RawItem } from './fetch';

const p = promisify(execFile);

/**
 * 私有仓库 xiaomimi123/x-workbench-feed 的 feed/latest.json。
 * 读法按顺序：X_FEED_PATH（本地文件或克隆目录）→ X_FEED_TOKEN 或 GITHUB_TOKEN 走 GitHub contents API
 * → gh auth token → 本机 git 凭据 clone。密钥不进仓库，也不写进报错。
 *
 * 帖子和 hot_topics 记成 X。浏览数是热度；没有浏览数才退回点赞。
 * 自回（is_reply 且 category=self）浏览和互动都很小的丢掉。
 * reddit_hot 记成 Reddit。这份快照没有赞或分数，热度存 0，打分时当作没有热度。
 */

const REPO = 'https://github.com/xiaomimi123/x-workbench-feed.git';
const API = 'https://api.github.com/repos/xiaomimi123/x-workbench-feed/contents/feed/latest.json';
const CLONE_DIR = path.join(process.env.HOME ?? '/tmp', '.mediapilot', 'x-workbench-feed');

/** 自回低于这两条线就不当选题。改这里即可。 */
export const SELF_REPLY_VIEWS = 2_000;
export const SELF_REPLY_ENGAGEMENT = 10;

export const FEED_ACCESS_ERROR =
  'x-workbench-feed 是私有仓库，当前没有访问权限。在 .env 里设置 X_FEED_TOKEN 或 GITHUB_TOKEN，或先运行 gh auth login。也可以把本地克隆目录或 latest.json 写到 X_FEED_PATH。';

interface XPost {
  id?: string;
  handle?: string;
  text?: string;
  likes?: number;
  reposts?: number;
  replies?: number;
  quotes?: number;
  views?: number;
  url?: string;
  is_reply?: boolean;
  category?: string;
}

interface RedditPost {
  id?: string;
  subreddit?: string;
  topic?: string;
  title?: string;
  url?: string;
  summary?: string;
}

const engagement = (post: XPost) => (post.likes ?? 0) + (post.reposts ?? 0) + (post.replies ?? 0) + (post.quotes ?? 0);

export function skipSelfReply(post: XPost): boolean {
  if (!post.is_reply || post.category !== 'self') return false;
  return (post.views ?? 0) < SELF_REPLY_VIEWS && engagement(post) < SELF_REPLY_ENGAGEMENT;
}

const linkOnly = (text: string) => /^(\s*(https?:\/\/\S+|t\.co\/\S+)\s*)+$/.test(text);

function xItem(post: XPost): RawItem | null {
  const text = post.text?.trim() ?? '';
  if (!post.id || !text || linkOnly(text)) return null;
  const heat = typeof post.views === 'number' ? post.views : (post.likes ?? 0);
  return {
    provider: 'x',
    outerId: `x:${post.id}`,
    title: text.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 80),
    summary: text.slice(0, 500),
    url: post.url ?? (post.handle ? `https://x.com/${post.handle}/status/${post.id}` : `https://x.com/i/status/${post.id}`),
    heat,
  };
}

function redditItem(post: RedditPost): RawItem | null {
  const title = post.title?.trim() ?? '';
  if (!post.id || !title) return null;
  const summary = [post.summary?.trim(), post.topic ? `话题 ${post.topic}` : '', post.subreddit ? `r/${post.subreddit}` : ''].filter(Boolean).join('\n');
  return {
    provider: 'reddit',
    outerId: `reddit:${post.id}`,
    title: title.slice(0, 120),
    summary: summary.slice(0, 500) || null,
    url: post.url ?? `https://www.reddit.com/comments/${post.id.replace(/^t3_/, '')}`,
    heat: 0,
  };
}

/** 解析 latest.json。X 帖（含 hot_topics）在前，Reddit 在后。同一条 X 以 hot_topics 为准。 */
export function parseFeed(json: string, _now: Date): RawItem[] {
  const feed = JSON.parse(json) as { posts?: XPost[]; hot_topics?: XPost[]; reddit_hot?: RedditPost[] };
  const byId = new Map<string, RawItem>();
  for (const post of feed.posts ?? []) {
    if (skipSelfReply(post)) continue;
    const item = xItem(post);
    if (item && post.id) byId.set(post.id, item);
  }
  for (const topic of feed.hot_topics ?? []) {
    const item = xItem(topic);
    if (item && topic.id) byId.set(topic.id, item);
  }
  const reddit = (feed.reddit_hot ?? []).map(redditItem).filter((item): item is RawItem => item !== null);
  return [...byId.values(), ...reddit];
}

async function resolveLocal(target: string): Promise<string> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) throw new Error(`X_FEED_PATH 读不到：${target}`);
  if (stat.isFile()) return target;
  for (const rel of ['feed/latest.json', 'latest.json']) {
    const file = path.join(target, rel);
    try {
      await fs.access(file);
      return file;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(`X_FEED_PATH 是目录，里面没有 feed/latest.json：${target}`);
}

async function tokenFromGh(): Promise<string | null> {
  try {
    const { stdout } = await p('gh', ['auth', 'token'], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function resolveToken(): Promise<string | null> {
  const fromEnv = process.env.X_FEED_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return tokenFromGh();
}

async function fetchRaw(token: string): Promise<string> {
  const r = await fetch(API, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github.raw', 'user-agent': 'MediaPilot' },
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error(FEED_ACCESS_ERROR);
  if (!r.ok) throw new Error(FEED_ACCESS_ERROR);
  return r.text();
}

function gitEnv(token: string | null): NodeJS.ProcessEnv {
  if (!token) return process.env;
  return { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${token}` };
}

/** clone 或 pull。凭据走环境，不写进仓库地址。私有库拒绝时直接抛出说明，不把令牌打进错误。 */
async function updateClone(token: string | null): Promise<string> {
  const gitDir = path.join(CLONE_DIR, '.git');
  const hasGit = await fs.access(gitDir).then(() => true).catch(() => false);
  const args = hasGit ? ['-C', CLONE_DIR, 'pull', '--ff-only'] : ['clone', '--depth', '1', REPO, CLONE_DIR];
  try {
    await p('git', args, { timeout: 60_000, env: gitEnv(token) });
  } catch (e) {
    if (!hasGit) await fs.rm(CLONE_DIR, { recursive: true, force: true }).catch(() => null);
    const msg = e instanceof Error ? e.message : String(e);
    if (/authentication|Username|Repository not found|not found|403|401|Permission denied|terminal prompts disabled/i.test(msg)) {
      throw new Error(FEED_ACCESS_ERROR);
    }
    throw new Error(FEED_ACCESS_ERROR);
  }
  return path.join(CLONE_DIR, 'feed', 'latest.json');
}

export async function loadFeedJson(): Promise<string> {
  const override = process.env.X_FEED_PATH?.trim();
  if (override) return fs.readFile(await resolveLocal(override), 'utf8');
  const token = await resolveToken();
  if (token) {
    try {
      return await fetchRaw(token);
    } catch (e) {
      if (e instanceof Error && e.message === FEED_ACCESS_ERROR) {
        /* 令牌被拒时再试一次本机 git */
      } else {
        throw e;
      }
    }
  }
  const file = await updateClone(token);
  return fs.readFile(file, 'utf8');
}

/** 抓 X 热帖和同一份快照里的 Reddit。 */
export async function fetchX(now: Date): Promise<RawItem[]> {
  const json = await loadFeedJson();
  return parseFeed(json, now);
}
