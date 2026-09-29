import { RetroView } from '@/components/retro/retro-view';

export const dynamic = 'force-dynamic';

export default function RetroPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">复盘</h1>
      <RetroView />
    </div>
  );
}
