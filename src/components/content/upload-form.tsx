'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts';

export function UploadForm({ needsBaselineOnboarding = false }: { needsBaselineOnboarding?: boolean }) {
  const router = useRouter();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState<string>('');
  const [baselinePlays, setBaselinePlays] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const searchParams = useSearchParams();

  useEffect(() => {
    const saved = localStorage.getItem('mediapilot:lastNiche');
    if (saved) setNiche(saved);
  }, []);

  // Prefill from script-generate flow (?title=...&caption=...&niche=...)
  useEffect(() => {
    if (!searchParams) return;
    const qpTitle = searchParams.get('title');
    const qpCaption = searchParams.get('caption');
    const qpNiche = searchParams.get('niche');
    if (qpTitle && !title) setTitle(qpTitle);
    if (qpCaption && !caption) setCaption(qpCaption);
    if (qpNiche) {
      const known = KNOWN_NICHES.find((n) => n.key === qpNiche);
      if (known) {
        setNiche(qpNiche);
      } else {
        setNiche('__custom');
        setCustomNiche(qpNiche);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;

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
      if (effectiveNiche) fd.append('niche', effectiveNiche);
      const baselineTrimmed = baselinePlays.trim();
      if (baselineTrimmed && Number(baselineTrimmed) > 0) {
        fd.append('baselinePlays', baselineTrimmed);
      }
      const fromScript = searchParams?.get('fromScript');
      if (fromScript) fd.append('fromScript', fromScript);

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
      <p className="text-xs text-[var(--muted)]">
        没准备稿子?{' '}
        <Link
          href="/content/script/new"
          className="hover:text-primary underline-offset-2 hover:underline"
        >
          让 AI 帮你写 →
        </Link>
      </p>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-4 pt-6">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--line-dark)] bg-[var(--surface-soft)] p-12 text-center cursor-pointer"
            onClick={() => videoInputRef.current?.click()}
          >
            {videoFile ? (
              <>
                <div className="font-medium">{videoFile.name}</div>
                <div className="text-xs text-[var(--muted)]">{(videoFile.size / 1024 / 1024).toFixed(1)} MB · 点击重选</div>
              </>
            ) : (
              <>
                <div className="font-medium">拖拽视频或点击选择</div>
                <div className="text-xs text-[var(--muted)]">mp4 / mov / webm · ≤ 500MB · ≤ 15 分钟</div>
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

      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
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
              className="min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
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
            {coverFile && <p className="text-xs text-[var(--muted)]">已选: {coverFile.name}</p>}
          </div>
          <div className="space-y-1">
            <Label>内容垂类</Label>
            <select
              value={niche}
              onChange={(e) => {
                const v = e.target.value;
                setNiche(v);
                if (v !== '__custom') localStorage.setItem('mediapilot:lastNiche', v);
              }}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
            >
              {KNOWN_NICHES.map((n) => (
                <option key={n.key} value={n.key}>{n.label}</option>
              ))}
              <option value="__custom">其他 (自填)</option>
            </select>
            {niche === '__custom' && (
              <Input
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                placeholder="e.g. 健身, 二次元, 财经"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {needsBaselineOnboarding && (
        <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
          <CardContent className="space-y-2 pt-6">
            <div className="rounded-md border-2 border-dashed border-amber-300 bg-amber-50 p-3">
              <Label htmlFor="baselinePlays" className="text-sm font-medium">
                一次性设置: 你最近 10 条视频平均多少播放?
              </Label>
              <p className="mt-1 text-xs text-[var(--muted)]">
                用于校准 L1 预测。 不填的话短期内不出预测, 等 3 条复盘后会从实测数据自动算出。
              </p>
              <Input
                id="baselinePlays"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="例如: 800"
                value={baselinePlays}
                onChange={(e) => setBaselinePlays(e.target.value)}
                className="mt-2"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submitting || !videoFile} variant="brand" size="lg">
          {submitting ? '上传中...' : '开始分析 →'}
        </Button>
      </div>
    </div>
  );
}
