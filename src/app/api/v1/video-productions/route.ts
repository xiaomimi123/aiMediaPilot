import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const LIBRARY_LIMIT = 100;

/**
 * 成片库(二十一期) —— 列出该用户全部视频生成任务, 不分发起入口。
 *
 * 真实使用暴露的问题: 片子生成成功了, 界面上却没有任何一条路径能通向它 ——
 * 模板页的历史列表藏在出片向导内页、且只在 masterPath 存在时给链接, 而预览就绪
 * (只有 previewPath)的任务在列表里就是一行干瘪的状态文字。用户找不到自己的片子。
 *
 * 这里刻意**不按 templateId 过滤**: 内容详情页旧入口发起的任务 templateId 为空,
 * 它们同样是用户的片子, 漏掉就等于这个库只覆盖一半。
 *
 * 内容标题与模板名各用一次批量查询回填(而不是 N+1 逐条查), 且都限制在当前用户内。
 */
export async function GET(_req: Request) {
  const user = await getOrCreateDefaultUser();

  const productions = await prisma.videoProduction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: LIBRARY_LIMIT,
    select: {
      id: true,
      status: true,
      mode: true,
      masterPath: true,
      previewPath: true,
      contentId: true,
      templateId: true,
      createdAt: true,
      errorMessage: true,
    },
  });

  const contentIds = [...new Set(productions.map((p) => p.contentId).filter(Boolean))];
  const templateIds = [...new Set(productions.map((p) => p.templateId).filter((v): v is string => Boolean(v)))];

  const [contents, templates] = await Promise.all([
    contentIds.length
      ? prisma.cockpitContent.findMany({
          where: { userId: user.id, id: { in: contentIds } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    templateIds.length
      ? prisma.videoTemplate.findMany({
          where: { userId: user.id, id: { in: templateIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const titleById = new Map(contents.map((c) => [c.id, c.title]));
  const templateNameById = new Map(templates.map((t) => [t.id, t.name]));

  return ok({
    productions: productions.map((p) => ({
      ...p,
      // 内容卡/模板可能已被删除 —— 回填不到就是 null, 不让整个库塌掉。
      contentTitle: titleById.get(p.contentId) ?? null,
      templateName: p.templateId ? templateNameById.get(p.templateId) ?? null : null,
    })),
  });
}
