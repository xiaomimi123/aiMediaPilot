import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';

/**
 * gpt-image 生图 API key 解析 — 设置卡 (AIConfig, AES-256-GCM 加密)。
 *
 * 结构照 `resolveDeepSeekApiKey` (`resolve-key.ts`)：查该用户 provider='gpt-image'
 * 的 AIConfig 行 (理论上因 `@@unique([userId, provider])` 最多一条, 但仍按
 * isDefault 优先 + 最新兜底排序, 对未来放宽约束保持健壮), 解密成功即用。
 *
 * **与 resolveDeepSeekApiKey 的关键差异：无 `.env` 回退。** 生图 key 只能来自
 * Settings 里配置的 AIConfig 行——查不到行 / 解密失败 (ENCRYPTION_KEY 变更或数据
 * 损坏, 参考 `radar/config.ts` 的 `getDecryptedTavilyKey` 先例) 都直接返回
 * null, 不读取任何环境变量, 调用方按原有逻辑处理 (提示去 Settings 配置)。
 *
 * 绝不在日志里打印明文/密文 key —— 出错只记错误信息本身。
 */
export async function resolveImageApiKey(userId: string): Promise<string | null> {
  try {
    const rows = await prisma.aIConfig.findMany({
      where: { userId, provider: 'gpt-image' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    const row = rows[0];
    if (row) {
      try {
        return decrypt(row.apiKey);
      } catch (e) {
        console.warn(
          '[resolveImageApiKey] AIConfig 记录解密失败 (ENCRYPTION_KEY 变更或数据损坏)',
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  } catch (e) {
    console.warn(
      '[resolveImageApiKey] AIConfig 查询失败',
      e instanceof Error ? e.message : String(e),
    );
  }
  return null;
}
