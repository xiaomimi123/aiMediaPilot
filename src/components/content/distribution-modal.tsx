'use client';

import { useState } from 'react';
import { DISTRIBUTION_PLATFORMS } from '@/lib/pipeline/platforms';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DistributionModal({
  scriptId, onDone, onClose,
}: { scriptId: string; onDone: () => void; onClose: () => void }) {
  const [platform, setPlatform] = useState(DISTRIBUTION_PLATFORMS[1].key); // 默认 bilibili
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!/^https?:\/\//.test(url.trim())) {
      setError('链接必须以 http(s):// 开头');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/scripts/${scriptId}/distributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, url: url.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onDone();
      onClose();
    } else {
      const j = await res?.json().catch(() => null);
      setError(j?.message ?? '登记失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel-bg)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">登记分发</h3>
        <div className="flex flex-wrap gap-2">
          {DISTRIBUTION_PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatform(p.key)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm',
                platform === p.key ? 'border-[#d6b6a8] bg-[var(--clay-soft)] text-[#8f3f28]' : 'hover:bg-[var(--hover-bg)]',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴发布链接 https://…"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button variant="brand" size="sm" onClick={submit} disabled={busy}>登记</Button>
        </div>
      </div>
    </div>
  );
}
