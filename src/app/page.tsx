import { prisma } from '@/lib/prisma';
import { accountLine, loadHome } from '@/lib/overview/home';
import { loadOverview } from '@/lib/overview/load';
import { HomeDesk } from '@/components/overview/home-desk';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const now = new Date();
  const [home, overview] = await Promise.all([loadHome(prisma, now), loadOverview(prisma, now)]);
  return (
    <HomeDesk
      picks={home.picks}
      totalHot={home.totalHot}
      ideas={home.ideas}
      writing={overview.inProgress.map((w) => ({ id: w.id, title: w.title }))}
      sources={home.sources}
      fetchLine={home.fetchLine}
      account={accountLine(overview.metrics)}
    />
  );
}
