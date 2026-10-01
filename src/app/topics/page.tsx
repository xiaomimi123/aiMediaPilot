import { TopicsView } from '@/components/topics/topics-view';

export const dynamic = 'force-dynamic';

export default function TopicsPage() {
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-5 text-[22px] font-bold">选题</h1>
      <TopicsView />
    </div>
  );
}
