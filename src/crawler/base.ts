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
  /**
   * 登录模态当前是否在 DOM 里。bind-worker 用"先见后无"状态机判定登录:
   * 必须先看到 modal 出现,再看到它消失,才认登录成功 — 避免页面初次加载尚未渲染时误判。
   */
  isLoginModalVisible(page: Page): Promise<boolean>;
  /** 抓登录页当前的二维码 src (含 data:image 前缀)。QR 周期刷新,worker 轮询调用。 */
  fetchQrCode(page: Page): Promise<string | null>;
  /** 已登录 context 上抓主页 */
  scrapeProfile(ctx: BrowserContext): Promise<ProfileSnapshot>;
  /** 已登录 context 上抓笔记列表 */
  scrapeNotes(ctx: BrowserContext, limit: number): Promise<NoteSummary[]>;
}
