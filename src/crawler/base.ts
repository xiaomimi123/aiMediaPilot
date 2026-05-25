import type { BrowserContext, Page } from 'playwright-core';

export interface ProfileSnapshot {
  platformUid: string;
  nickname: string;
  avatar?: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
  noteCount: number;
  likeCount: number;
}

export interface NoteSummary {
  platformNoteId: string;
  title: string;
  type: 'IMAGE_TEXT' | 'VIDEO' | 'LIVE';
  coverUrl?: string;
  tags: string[];
  publishedAt?: Date;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
  collectCount: number;
  sourceUrl?: string;
}

export interface ICrawler {
  /** 判断当前页是否已登录 */
  isLoggedIn(page: Page): Promise<boolean>;
  /** 已登录 context 上抓主页 */
  scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot>;
  /** 已登录 context 上抓笔记列表 */
  scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]>;
}
