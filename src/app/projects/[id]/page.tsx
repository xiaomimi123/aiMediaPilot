import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { loadProjectBundle } from '@/lib/project/load';
import { ProjectWorkspace } from '@/components/project/project-workspace';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const bundle = await loadProjectBundle(prisma, params.id);
  if (!bundle) notFound();
  return (
    <ProjectWorkspace
      initialProject={bundle.project}
      initialMessages={bundle.messages}
      initialRecording={bundle.recording}
      initialJobs={bundle.jobs}
      initialMaterials={bundle.materials}
      initialFilms={bundle.films}
    />
  );
}
