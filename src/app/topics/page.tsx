import { TopicsView } from '@/components/topics/topics-view';

export const dynamic = 'force-dynamic';

export default function TopicsPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">选题</h1>
      <TopicsView />
    </div>
  );
}
