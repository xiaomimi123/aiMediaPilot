import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { getOrCreateDefaultUser } from '@/lib/user';
import { validateProxyShape, type ProxyConfig } from '@/lib/proxy';
import { bindQueue } from '@/jobs/queue';
import type { Platform } from '@prisma/client';

const ALLOWED_PLATFORMS: Platform[] = ['XIAOHONGSHU', 'DOUYIN'];
const SESSION_TTL_MIN = 8;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      platform?: Platform;
      proxy?: Partial<ProxyConfig> | null;
    } | null;

    if (!body?.platform) return fail('platform required');
    if (!ALLOWED_PLATFORMS.includes(body.platform)) return fail(`unsupported platform: ${body.platform}`);

    let proxyEncrypted: string | null = null;
    if (body.proxy) {
      const err = validateProxyShape(body.proxy);
      if (err) return fail(`proxy invalid: ${err}`);
      proxyEncrypted = encrypt(JSON.stringify(body.proxy));
    }

    const user = await getOrCreateDefaultUser();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60_000);
    const sessionData: any = {
      userId: user.id,
      platform: body.platform,
      cdpUrl: process.env.CHROMIUM_REMOTE_DEBUG_URL || 'http://localhost:9222',
      vncPath: '',
      expiresAt,
    };

    if (proxyEncrypted) {
      sessionData.proxyTest = { encrypted: true };
    }

    const session = await prisma.browserSession.create({
      data: sessionData,
    });

    await bindQueue.add(
      'bind',
      { sessionId: session.id, encryptedProxy: proxyEncrypted },
      { jobId: `bind-${session.id}`, removeOnComplete: true, removeOnFail: false }
    );

    return ok({
      sessionId: session.id,
      vncUrl: `${process.env.CHROMIUM_VNC_URL || 'http://localhost:6080'}/vnc.html?autoconnect=1&resize=scale&path=websockify`,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return fail(msg, 500);
  }
}
