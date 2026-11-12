import { TopicsView } from '@/components/topics/topics-view';

export const dynamic = 'force-dynamic';

export default function TopicsPage() {
  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-10">
      <h1 className="page-title mb-7">选题</h1>
      <TopicsView />
    </div>
  );
}
