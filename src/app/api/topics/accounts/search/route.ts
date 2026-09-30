import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { takeSearchQuota, SEARCH_DAILY_LIMIT } from '@/lib/benchmark/quota';
import { toAccountView } from '@/lib/benchmark/view';
import { explainAnalyzeError } from '@/lib/benchmark/analyze';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { keyword } = (await req.json().catch(() => ({}))) as { keyword?: string };
  const kw = typeof keyword === 'string' ? keyword.trim() : '';
  if (!kw || kw.length > 20) return fail('输入一个关键词（20 字以内），如「AI工具」', 400);
  if (!(await takeSearchQuota())) return fail(`今天搜索次数用完了（每天 ${SEARCH_DAILY_LIMIT} 次，保护账号），明天再搜。`, 429);
  try {
    const found = await createDouyinClient().searchUsers(kw);
    const store = createPrismaStore(prisma);
    const rows = [];
    for (const p of found) rows.push(await store.upsertAccount(p, { status: 'candidate', source: 'search', searchKeyword: kw }));
    return ok(rows.map((a) => toAccountView(a, null)));
  } catch (e) {
    return fail(explainAnalyzeError(e), 502);
  }
}
