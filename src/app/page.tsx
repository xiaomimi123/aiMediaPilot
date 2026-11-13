import { prisma } from '@/lib/prisma';
import { accountLine, loadHome } from '@/lib/overview/home';
import { loadOverview } from '@/lib/overview/load';
import { HomeDesk } from '@/components/overview/home-desk';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const now = new Date();
  const [home, overview] = await Promise.all([loadHome(prisma, now), loadOverview(prisma, now)]);
  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-10">
      <HomeDesk
        hot={home.hot}
        moreHot={home.moreHot}
        ideas={home.ideas}
        writing={overview.inProgress.map((w) => ({ id: w.id, title: w.title }))}
        account={accountLine(overview.metrics)}
      />
    </div>
  );
}
