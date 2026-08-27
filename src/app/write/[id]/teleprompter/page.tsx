import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { buildTeleprompterScript, estimateActSpeed, COMFORTABLE_SPEED } from '@/lib/cockpit/teleprompter';

export const dynamic = 'force-dynamic';

/**
 * 提词器(阶段 4 重建)。手机架在电脑前, 看这一屏念。
 *
 * 服务端渲染, 不带滚动控制 —— 旧版那套空格/↑↓ 的自动滚动在真实录制里用处有限
 * (语速一改就对不上), 保留真正有用的部分: 大字、按幕分段、每幕的目标时长与
 * 所需语速。语速超出舒适区在开录前就提示, 不用录到一半才发现念不完。
 */
export default async function TeleprompterPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) notFound();

  const acts = parseDraftOutput(draft.output)?.acts;
  const rows = acts ? buildTeleprompterScript(acts) : [];
  const totalSec = rows.reduce((n, r) => n + r.targetSec, 0);

  return (
    <main className="flex-1 overflow-y-auto bg-foreground text-background">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <header className="mb-8 flex items-baseline justify-between gap-4 border-b border-background/20 pb-3">
          <h1 className="truncate text-sm opacity-70">{draft.topic}</h1>
          <div className="flex shrink-0 items-baseline gap-4 text-sm opacity-70">
            <span className="tabular-nums">全片 {totalSec} 秒</span>
            <Link href={`/write/${id}`} className="underline underline-offset-4">
              回工作区
            </Link>
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="opacity-70">这份稿子不是六幕结构，没法提词。</p>
        ) : (
          rows.map((r) => {
            const speed = estimateActSpeed(r.narration, r.targetSec);
            const tooFast = speed > COMFORTABLE_SPEED.max;
            const tooSlow = speed > 0 && speed < COMFORTABLE_SPEED.min;
            return (
              <section key={r.act} className="mb-12">
                <p className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm opacity-60">
                  <span>{r.title}</span>
                  <span className="tabular-nums">
                    {r.startSec}s – {r.startSec + r.targetSec}s
                  </span>
                  {tooFast ? <span className="text-red-400">字偏多，要念到 {speed.toFixed(1)} 字/秒</span> : null}
                  {tooSlow ? <span className="text-amber-400">字偏少，只需 {speed.toFixed(1)} 字/秒</span> : null}
                </p>
                {r.lines.map((line, i) => (
                  <p key={i} className="mb-5 text-3xl font-medium leading-relaxed">
                    {line}
                  </p>
                ))}
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
