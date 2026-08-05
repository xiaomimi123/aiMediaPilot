'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PublishLinkForm({
  analysisId,
  initialUrl,
  initialPublishedAt,
  onSaved,
}: {
  analysisId: string;
  initialUrl?: string | null;
  initialPublishedAt?: string | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [publishedAt, setPublishedAt] = useState(
    initialPublishedAt ? new Date(initialPublishedAt).toISOString().slice(0, 16) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!url.trim() || !publishedAt) {
      setError('请填写视频链接和发布时间');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/content/analyses/${analysisId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), publishedAt: new Date(publishedAt).toISOString() }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--panel-bg)] p-4">
      <div className="text-sm font-semibold">📤 已发布到抖音?</div>
      <div className="space-y-1">
        <Label>抖音视频链接</Label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.douyin.com/video/..." />
      </div>
      <div className="space-y-1">
        <Label>发布时间</Label>
        <Input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
      </div>
      {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
      <Button onClick={handleSubmit} disabled={submitting || !url || !publishedAt}>
        {submitting ? '保存中...' : '保存并安排 T+3d 复盘 →'}
      </Button>
    </div>
  );
}
