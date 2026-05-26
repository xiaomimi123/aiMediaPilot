import { Worker, type Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { decrypt } from '@/lib/crypto';
import type { ProxyConfig } from '@/lib/proxy';
import { openContext } from '@/crawler/browser-pool';
import { xiaohongshuCrawler } from '@/crawler/xiaohongshu/crawler';
import { fetchXiaohongshuQrCode } from '@/crawler/xiaohongshu/login-detector';
import { PLATFORM_META } from '@/lib/platform';
import { QUEUES } from '@/jobs/queue';
import type { SessionStatus } from '@prisma/client';

type JobData = { sessionId: string; encryptedProxy: string | null };

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 8 * 60 * 1000;

async function setStatus(sessionId: string, status: SessionStatus) {
  await prisma.browserSession.update({ where: { id: sessionId }, data: { status } });
}

async function handleBind(job: Job<JobData>) {
  const { sessionId, encryptedProxy } = job.data;
  const session = await prisma.browserSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`session ${sessionId} not found`);

  const platform = session.platform;
  const meta = PLATFORM_META[platform];
  const crawler = platform === 'XIAOHONGSHU' ? xiaohongshuCrawler : null;
  if (!crawler) throw new Error(`Plan 1 仅支持小红书,收到 ${platform}`);

  const proxy: ProxyConfig | null = encryptedProxy ? JSON.parse(decrypt(encryptedProxy)) : null;

  await setStatus(sessionId, 'STARTING');
  const ctx = await openContext({ proxy });
  const page = await ctx.newPage();
  await page.goto(meta.loginUrl, { waitUntil: 'domcontentloaded' });
  await setStatus(sessionId, 'WAITING_LOGIN');

  const startedAt = Date.now();
  let loggedIn = false;
  let cancelled = false;
  let lastQr: string | null = null;
  let lastLog = 0;
  while (Date.now() - startedAt < MAX_POLL_MS) {
    // 检查 session 是否被用户取消(API 把 status 改成 EXPIRED)
    const current = await prisma.browserSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (!current || current.status === 'EXPIRED' || current.status === 'ERROR') {
      cancelled = true;
      break;
    }

    const isIn = await crawler.isLoggedIn(page);
    // 每 5 秒打印一次诊断:URL + login-container count + isLoggedIn 判定
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      const url = page.url();
      const containerCount = await page.locator('.login-container').count().catch(() => -1);
      console.log(
        `[bind-worker:${sessionId.slice(0, 8)}] url=${url.slice(0, 80)} login-container=${containerCount} isLoggedIn=${isIn}`
      );
    }
    if (isIn) { loggedIn = true; break; }

    // 抓 QR (仅小红书)
    if (platform === 'XIAOHONGSHU') {
      const qr = await fetchXiaohongshuQrCode(page);
      if (qr && qr !== lastQr) {
        lastQr = qr;
        await prisma.browserSession.update({
          where: { id: sessionId },
          data: { qrCode: qr, status: 'WAITING_LOGIN' },
        });
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (cancelled) {
    await ctx.close();
    return; // 不抛错,任务正常结束,worker 释放去处理下一个
  }

  if (!loggedIn) {
    await setStatus(sessionId, 'EXPIRED');
    await ctx.close();
    throw new Error('login timeout');
  }

  await setStatus(sessionId, 'SCRAPING');
  try {
    const profile = await crawler.scrapeProfile(ctx);
    const notes = await crawler.scrapeNotes(ctx, 20);

    const account = await prisma.platformAccount.upsert({
      where: { platform_platformUid: { platform, platformUid: profile.platformUid } },
      update: {
        nickname: profile.nickname,
        avatar: profile.avatar,
        bio: profile.bio,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        likeCount: profile.likeCount,
        loginStatus: 'VALID',
        lastSyncAt: new Date(),
        proxy: encryptedProxy ? { encrypted: encryptedProxy } : undefined,
      },
      create: {
        userId: session.userId,
        platform,
        platformUid: profile.platformUid,
        nickname: profile.nickname,
        avatar: profile.avatar,
        bio: profile.bio,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        likeCount: profile.likeCount,
        loginStatus: 'VALID',
        lastSyncAt: new Date(),
        proxy: encryptedProxy ? { encrypted: encryptedProxy } : undefined,
      },
    });

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    await prisma.accountMetric.upsert({
      where: { accountId_date: { accountId: account.id, date: today } },
      update: {
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        totalLikes: profile.likeCount,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
      },
      create: {
        accountId: account.id,
        date: today,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        noteCount: profile.noteCount,
        totalLikes: profile.likeCount,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
      },
    });

    for (const n of notes) {
      await prisma.platformNote.upsert({
        where: { accountId_platformNoteId: { accountId: account.id, platformNoteId: n.platformNoteId } },
        update: {
          title: n.title,
          type: n.type,
          coverUrl: n.coverUrl,
          tags: n.tags,
          likeCount: n.likeCount,
          sourceUrl: n.sourceUrl,
        },
        create: {
          accountId: account.id,
          platformNoteId: n.platformNoteId,
          title: n.title,
          type: n.type,
          coverUrl: n.coverUrl,
          tags: n.tags,
          likeCount: n.likeCount,
          sourceUrl: n.sourceUrl,
        },
      });
    }

    await prisma.browserSession.update({
      where: { id: sessionId },
      data: { status: 'LOGGED_IN', accountId: account.id },
    });
  } finally {
    await ctx.close();
  }
}

export function startBindWorker() {
  const worker = new Worker<JobData>(QUEUES.BIND, handleBind, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[bind-worker] failed', job?.id, err);
  });
  worker.on('completed', (job) => {
    console.log('[bind-worker] completed', job.id);
  });
  return worker;
}
