import { prisma } from "@/lib/prisma";
import { getOrCreateDefaultUser } from "@/lib/user";
import { parseDraftOutput } from "@/lib/cockpit/draft-restore";
import { TeleprompterView } from "@/components/cockpit/teleprompter-view";
import { combineScore, readActsFromDraftOutput } from "@/lib/cockpit/script-score";

/**
 * 提词器页(二十一期) —— 手机架在电脑前录口播时看这一屏。
 * 数据在服务端直接取: 提词器是录制现场用的, 少一次客户端请求就少一次转圈。
 */
export default async function TeleprompterPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();
  const content = await prisma.cockpitContent.findUnique({ where: { id } });

  if (!content || content.userId !== user.id) {
    return <section className="teleprompter-empty"><p>内容不存在。</p></section>;
  }

  const draft = content.scriptDraftId
    ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
    : null;
  const parsed = draft ? parseDraftOutput(draft.output) : null;

  // 评分在服务端算好传下去 —— 录制现场少一次客户端往返(同本页取稿的理由)
  const scorable = draft ? readActsFromDraftOutput(draft.output) : null;
  const score = scorable ? combineScore(scorable, content.scriptScore) : null;

  return <TeleprompterView acts={parsed?.acts ?? []} title={content.title} score={score} />;
}
