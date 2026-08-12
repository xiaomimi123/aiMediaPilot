import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/crypto';

/**
 * 热点雷达 — 配置存取。
 *
 * 加密复用 `src/lib/crypto.ts`（AES-256-GCM），与 AI 供应商配置
 * (`src/app/api/v1/ai/config/route.ts`) 用同一套 encrypt/decrypt/maskKey —
 * 该模块本来就是独立 lib 文件（非路由内联），直接 import 即可，无需再抽取。
 *
 * 空串 = 未配置 语义（对齐 Task 1 ledger 备注 + `RadarConfig.tavilyKeyEncrypted @default("")`）：
 * 数据库里 tavilyKeyEncrypted 为 `''` 表示用户从未填过 key，不当作一个"加密后的空字符串"去 decrypt。
 */

const DEFAULT_DAILY_LIMIT = 20;

/** 面向前端/一般调用方的安全视图 — 绝不含明文或密文 key。 */
export interface RadarConfigSafe {
  hasKey: boolean;
  dailyLimit: number;
  enabled: boolean;
}

export interface SaveRadarConfigInput {
  /** 传入空字符串 = 显式清空已配置的 key；不传 = 保持原值不变。 */
  tavilyKey?: string;
  dailyLimit?: number;
  enabled?: boolean;
}

export async function getRadarConfig(userId: string): Promise<RadarConfigSafe> {
  const row = await prisma.radarConfig.findUnique({ where: { userId } });
  if (!row) {
    return { hasKey: false, dailyLimit: DEFAULT_DAILY_LIMIT, enabled: false };
  }
  return {
    hasKey: row.tavilyKeyEncrypted !== '',
    dailyLimit: row.dailyLimit,
    enabled: row.enabled,
  };
}

export async function saveRadarConfig(userId: string, patch: SaveRadarConfigInput): Promise<void> {
  const data: { tavilyKeyEncrypted?: string; dailyLimit?: number; enabled?: boolean } = {};
  if (patch.tavilyKey !== undefined) {
    data.tavilyKeyEncrypted = patch.tavilyKey === '' ? '' : encrypt(patch.tavilyKey);
  }
  if (patch.dailyLimit !== undefined) data.dailyLimit = patch.dailyLimit;
  if (patch.enabled !== undefined) data.enabled = patch.enabled;

  await prisma.radarConfig.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      tavilyKeyEncrypted: data.tavilyKeyEncrypted ?? '',
      dailyLimit: data.dailyLimit ?? DEFAULT_DAILY_LIMIT,
      enabled: data.enabled ?? false,
    },
  });
}

/**
 * 解密后的真实 Tavily key — **只给 worker 用**（构造 TavilySearchProvider）。
 * 未配置 (空串) 或解密失败 (ENCRYPTION_KEY 变更/数据损坏) 时返回 null，调用方自行处理跳过逻辑。
 */
export async function getDecryptedTavilyKey(userId: string): Promise<string | null> {
  const row = await prisma.radarConfig.findUnique({ where: { userId } });
  if (!row || row.tavilyKeyEncrypted === '') return null;
  try {
    return decrypt(row.tavilyKeyEncrypted);
  } catch {
    return null;
  }
}
