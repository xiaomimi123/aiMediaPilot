import { ok, fail } from '@/lib/api';
import { runDouyinListAdapter } from '@/lib/douyin/list';

export async function GET() {
  try {
    const items = await runDouyinListAdapter();
    return ok(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET douyin/list] failed', e);
    return fail(`抖音列表拉取失败: ${msg}. 请检查 cheat-on-content 是否登录。`, 500);
  }
}
