'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export function UploadForm() {
  const router = useRouter();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!videoFile) {
      setError('请先选择视频文件');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('video', videoFile);
      if (coverFile) fd.append('draftCover', coverFile);
      if (title.trim()) fd.append('draftTitle', title.trim());
      if (caption.trim()) fd.append('draftCaption', caption.trim());

      const res = await fetch('/api/v1/content/analyses', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        setSubmitting(false);
        return;
      }
      router.push(`/content/preflight/${json.data.analysisId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-12 text-center cursor-pointer"
            onClick={() => videoInputRef.current?.click()}
          >
            <div className="text-3xl">📹</div>
            {videoFile ? (
              <>
                <div className="font-medium">{videoFile.name}</div>
                <div className="text-xs text-muted-foreground">{(videoFile.size / 1024 / 1024).toFixed(1)} MB · 点击重选</div>
              </>
            ) : (
              <>
                <div className="font-medium">拖拽视频或点击选择</div>
                <div className="text-xs text-muted-foreground">mp4 / mov / webm · ≤ 500MB · ≤ 15 分钟</div>
              </>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <Label>标题草稿 (留空 AI 生成 3 个候选)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ChatGPT 不告诉你的 5 个技巧" />
          </div>
          <div className="space-y-1">
            <Label>文案草稿 (留空 AI 生成 3 个候选)</Label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="..."
            />
          </div>
          <div className="space-y-1">
            <Label>封面 (留空将从视频抽 3 帧)</Label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
            {coverFile && <p className="text-xs text-muted-foreground">已选: {coverFile.name}</p>}
          </div>
          <div className="text-xs text-muted-foreground">
            垂类: <span className="font-medium">AI 知识</span> (后期可在设置里改)
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submitting || !videoFile}>
          {submitting ? '上传中...' : '开始分析 →'}
        </Button>
      </div>
    </div>
  );
}
