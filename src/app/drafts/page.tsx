import { DraftDesk } from '@/components/drafts/draft-desk';

export const dynamic = 'force-dynamic';

export default function DraftsPage({ searchParams }: { searchParams?: { draft?: string } }) {
  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-10">
      <h1 className="page-title mb-7">写稿台</h1>
      <DraftDesk initialOpen={searchParams?.draft ?? null} />
    </div>
  );
}
