import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { ScriptWorkspace } from '@/components/script/workspace';
import { readActsFromDraftOutput, readCachedSoft } from '@/lib/cockpit/script-score';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { SOFT_MAX } from '@/lib/llm/prompts/script-soft-score';

/** 读库页面必须强制动态, 否则会被预渲染成静态并把当时的数据烤进产物。 */
export const dynamic = 'force-dynamic';

/**
 * 六幕稿工作区页(阶段 4)。
 *
 * 服务端取数、客户端编辑: 页面间不共享状态(5.2), 草稿状态封装在
 * ScriptWorkspace 内不外泄。软指标读的是缓存(它要花钱调模型, 绝不在打开页面时
 * 触发); 硬指标是纯函数, 交给客户端随每次改动就地重算。
 */
export default async function WriteDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();

  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) notFound();

  // 用 parseDraftOutput 而不是评分用的 readActsFromDraftOutput: 后者只挑出打分要
  // 的四个字段, 拿它当编辑数据源会把 note/beats/facts 丢掉, 自动保存一落库就全没了。
  const parsed = parseDraftOutput(draft.output);
  const acts = parsed?.acts ?? null;
  if (!acts) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{draft.topic}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            这份稿子不是六幕结构（早期版本留下的），工作区改不了它。
          </p>
        </div>
      </main>
    );
  }

  const durationSec: number =
    parsed?.durationSec ?? acts.reduce((n: number, a) => n + a.targetSec, 0);

  // 软指标缓存挂在 CockpitContent 上 —— 稿子可能还没被内容卡采纳, 没有就是没跑过
  const content = await prisma.cockpitContent.findFirst({
    where: { userId: user.id, scriptDraftId: id },
    select: { scriptScore: true },
  });
  const soft = content ? readCachedSoft(content.scriptScore, acts) : null;

  return (
    <main className="flex-1 overflow-hidden">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
        <ScriptWorkspace
          scriptId={id}
          topic={draft.topic}
          platform={draft.platform}
          durationSec={durationSec}
          initialActs={acts}
          softScore={soft ? soft.dimensions.reduce((n, d) => n + d.score, 0) : null}
          softMax={SOFT_MAX}
          softDimensions={soft?.dimensions ?? []}
        />
      </div>
    </main>
  );
}
