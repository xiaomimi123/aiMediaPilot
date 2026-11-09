import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RawItem, SourceProvider } from './fetch';

const p = promisify(execFile);

/**
 * X（Twitter）热帖源——用户自建的抓取中转仓库 xiaomimi123/x-workbench-feed。
 * 仓库每小时自动 commit 一份 feed/latest.json（GroK Bot 抓的公开数据），
 * 本地用「缓存 clone + git pull」更新：raw.githubusercontent 对这个仓库一直 404，
 * jsDelivr 也不索引它，只有 git 协议稳定可达（2026-11-09 三种方式都试过）。
 *
 * 只留原创帖：抓到的帖子里大半是回复别人的碎碎念，不是改写题材。
 */

const REPO = 'https://github.com/xiaomimi123/x-workbench-feed.git';
const CLONE_DIR = path.join(process.env.HOME ?? '/tmp', '.mediapilot', 'x-workbench-feed');
const MAX_POSTS = 30;

interface FeedPost {
  id: string;
  handle: string;
  text: string;
  created_at: string;
  likes?: number;
  reposts?: number;
  replies?: number;
  views?: number;
  url?: string;
  is_reply?: boolean;
}

/** 更新缓存 clone（首次自动 clone）。网络偶发 SSL 抖动, 重试 3 次（500ms/1000ms 退避） */
async function updateClone(): Promise<string> {
  const hasGit = fs
    .access(path.join(CLONE_DIR, '.git'))
    .then(() => true)
    .catch(() => false);
  const args = await hasGit ? ['-C', CLONE_DIR, 'pull', '--ff-only'] : ['clone', '--depth', '1', REPO, CLONE_DIR];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p('git', args, { timeout: 60_000 });
      return path.join(CLONE_DIR, 'feed', 'latest.json');
    } catch (e) {
      lastErr = e;
      if (!hasGit) await fs.rm(CLONE_DIR, { recursive: true, force: true }).catch(() => null);
      await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
    }
  }
  throw new Error(`x-workbench-feed 仓库更新失败（重试 3 次）: ${lastErr instanceof Error ? lastErr.message.split('\n')[0] : String(lastErr)}`);
}

export function parseFeed(json: string, now: Date): RawItem[] {
  const feed = JSON.parse(json) as { posts?: FeedPost[] };
  const posts = (feed.posts ?? []).filter(
    (f) => !f.is_reply && f.text?.trim() && !/^(\s*(https?:\/\/\S+|t\.co\/\S+)\s*)+$/.test(f.text),
  );
  // 热度 = 浏览数（没浏览就退回点赞），取前 30
  const hot = posts
    .map((f) => ({ f, heat: f.views || f.likes || 0 }))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, MAX_POSTS);
  return hot.map(({ f, heat }) => ({
    provider: 'x' as SourceProvider,
    outerId: `x:${f.id}`,
    // 标题取正文第一行, 太长截断; 全文进 summary
    title: f.text.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 80) || f.text.slice(0, 80),
    summary: f.text.slice(0, 500),
    url: f.url ?? `https://x.com/${f.handle}/status/${f.id}`,
    heat,
  }));
}

/** 抓 X 热帖（原创帖，按浏览数取前 30） */
export async function fetchX(now: Date): Promise<RawItem[]> {
  const file = await updateClone();
  const json = await fs.readFile(file, 'utf8');
  return parseFeed(json, now);
}
