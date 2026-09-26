'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewProjectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          const j = await res.json();
          if (j.success) router.push(`/projects/${j.data.id}`);
          else {
            setError(j.message ?? '新建失败');
            setBusy(false);
          }
        }}
      >
        ＋ 新建项目
      </button>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
