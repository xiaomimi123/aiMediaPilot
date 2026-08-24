import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

// 列表页展示上限——模板用久了出片记录会无限增长, 只给最近的够用, 避免响应无限撑大。
const HISTORY_LIMIT = 20;

/**
 * 缺口3(task-10b): 按模板查历史出片列表(spec §5, 支撑"对同一模板不断调整迭代"的用法)。
 * 归属校验一律 404(不是 403), 与本项目既有约定一致。
 * 特意不 select srt/alignedActs/rawTranscript——列表页只展示状态与下载链接, 这几个字段
 * 是六幕稿/对齐结果/ASR 原文这类大 Json/String, 带上只会白白撑大响应。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const template = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!template || template.userId !== user.id) return fail('模板不存在', 404);

  const productions = await prisma.videoProduction.findMany({
    where: { templateId: template.id, userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      status: true,
      mode: true,
      masterPath: true,
      previewPath: true,
      contentId: true,
      createdAt: true,
      // 失败原因必须带回 —— 否则历史列表只能显示"生成失败"三个字, 用户只能去翻 worker 日志。
      errorMessage: true,
    },
  });

  return ok({ productions });
}
