import { DraftDesk } from '@/components/drafts/draft-desk';

export const dynamic = 'force-dynamic';

export default function DraftsPage({ searchParams }: { searchParams?: { draft?: string } }) {
  return (
    <div className="flex h-full flex-col overflow-hidden px-5 py-4">
      <h1 className="page-title mb-3">写稿台</h1>
      <div className="min-h-0 flex-1">
        <DraftDesk initialOpen={searchParams?.draft ?? null} />
      </div>
    </div>
  );
}
