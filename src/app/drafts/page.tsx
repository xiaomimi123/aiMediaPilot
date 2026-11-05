import { DraftDesk } from '@/components/drafts/draft-desk';

export const dynamic = 'force-dynamic';

export default function DraftsPage() {
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-5 text-[22px] font-bold">写稿台</h1>
      <DraftDesk />
    </div>
  );
}
