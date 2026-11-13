import { TopicsView } from '@/components/topics/topics-view';

export const dynamic = 'force-dynamic';

export default function TopicsPage() {
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <h1 className="page-title mb-4">选题</h1>
      <TopicsView />
    </div>
  );
}
