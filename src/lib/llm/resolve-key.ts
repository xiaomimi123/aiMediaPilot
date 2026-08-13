import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';

/**
 * DeepSeek API key 解析 — 设置卡 (AIConfig, AES-256-GCM 加密) 优先, `.env` 回退。
 *
 * 之前所有 DeepSeek 调用点都直读 `process.env.DEEPSEEK_API_KEY`, Settings「AI 服务
 * 配置」卡存的 key 从未被消费。这里桥接: 先查该用户 provider='deepseek' 的 AIConfig
 * 行 (理论上因 `@@unique([userId, provider])` 最多一条, 但仍按 isDefault 优先 + 最新
 * 兜底排序, 对未来放宽约束保持健壮), 解密成功即用; 查不到行 / 解密失败 (ENCRYPTION_KEY
 * 变更或数据损坏, 参考 `radar/config.ts` 的 `getDecryptedTavilyKey` 先例) 都 fall
 * through 到 `.env` 里的 DEEPSEEK_API_KEY; 两者皆无则返回 null, 调用方按原有逻辑处理
 * (400/500/503 或静默跳过, 各消费点行为不变)。
 *
 * 绝不在日志里打印明文/密文 key —— 出错只记错误信息本身。
 */
export async function resolveDeepSeekApiKey(userId: string): Promise<string | null> {
  try {
    const rows = await prisma.aIConfig.findMany({
      where: { userId, provider: 'deepseek' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    const row = rows[0];
    if (row) {
      try {
        return decrypt(row.apiKey);
      } catch (e) {
        console.warn(
          '[resolveDeepSeekApiKey] AIConfig 记录解密失败 (ENCRYPTION_KEY 变更或数据损坏), 回退 .env',
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  } catch (e) {
    console.warn(
      '[resolveDeepSeekApiKey] AIConfig 查询失败, 回退 .env',
      e instanceof Error ? e.message : String(e),
    );
  }
  return process.env.DEEPSEEK_API_KEY ?? null;
}
