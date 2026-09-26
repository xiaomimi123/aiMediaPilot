import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { toMessageView, toProjectView } from '@/lib/project/view';
import { ProjectWorkspace } from '@/components/project/project-workspace';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id } });
  if (!p) notFound();
  const messages = await prisma.chatMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
  return <ProjectWorkspace initialProject={toProjectView(p)} initialMessages={messages.map(toMessageView)} />;
}
