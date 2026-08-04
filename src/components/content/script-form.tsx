'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts';
import { ScriptResult } from './script-result';
import { cn } from '@/lib/utils';
import {
  CONTENT_PLATFORMS,
  CONTENT_PLATFORM_EMOJI,
  CONTENT_PLATFORM_LABEL,
  type ContentPlatform,
} from '@/lib/platform';

// 保留 Platform 别名, 老组件 import 稳定
export type Platform = ContentPlatform;

const PLATFORM_SUB: Record<ContentPlatform, string> = {
  douyin: '短视频脚本 + 钩子 + 完播节奏',
  xiaohongshu: '图文笔记 + 标签 + 配图建议',
  gongzhonghao: '长文章 + 大纲 + 摘要',
};

const PLATFORMS = CONTENT_PLATFORMS.map((value) => ({
  value,
  label: CONTENT_PLATFORM_LABEL[value],
  emoji: CONTENT_PLATFORM_EMOJI[value],
  sub: PLATFORM_SUB[value],
}));

interface InspirationStylePreview {
  hookTypes: string[];
  titlePatterns: string[];
  durationInsight: string;
}

export function ScriptForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('douyin');
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [inspirationId, setInspirationId] = useState<string | null>(null);
  const [inspirationStyle, setInspirationStyle] = useState<InspirationStylePreview | null>(null);

  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;
  const ideaId = searchParams?.get('ideaId') ?? undefined;
  const cockpitId = searchParams?.get('cockpitId') ?? undefined;

  // Prefill from inspiration → /agent loop (?topic=X&platform=Y&niche=Z&inspirationId=ID)
  useEffect(() => {
    if (!searchParams) return;
    const qpTopic = searchParams.get('topic');
    const qpPlatform = searchParams.get('platform');
    const qpNiche = searchParams.get('niche');
    const qpInspId = searchParams.get('inspirationId');
    if (qpTopic && !topic) setTopic(qpTopic);
    if (qpPlatform && (qpPlatform === 'douyin' || qpPlatform === 'xiaohongshu' || qpPlatform === 'gongzhonghao')) {
      setPlatform(qpPlatform);
    }
    if (qpNiche) {
      const known = KNOWN_NICHES.find((n) => n.key === qpNiche);
      if (known) {
        setNiche(qpNiche);
      } else {
        setNiche('__custom');
        setCustomNiche(qpNiche);
      }
    }
    if (qpInspId) {
      setInspirationId(qpInspId);
      fetch(`/api/v1/inspiration/insights/${qpInspId}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.success && j.data.output) {
            const o = j.data.output as Partial<InspirationStylePreview>;
            setInspirationStyle({
              hookTypes: Array.isArray(o.hookTypes) ? o.hookTypes : [],
              titlePatterns: Array.isArray(o.titlePatterns) ? o.titlePatterns : [],
              durationInsight: typeof o.durationInsight === 'string' ? o.durationInsight : '',
            });
          }
        })
        .catch(() => {
          /* silently ignore — not blocking */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleGenerate = async () => {
    setError(null);
    if (topic.trim().length < 3) {
      setError('topic 至少 3 字');
      return;
    }
    if (!effectiveNiche) {
      setError('请选 niche');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/scripts/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          niche: effectiveNiche,
          platform,
          ...(inspirationId ? { inspirationId } : {}),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
      } else {
        setResult(json.data as Record<string, unknown>);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {inspirationStyle && (
        <Card className="border-purple-200 bg-purple-50/40">
          <CardContent className="space-y-2 pt-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-purple-900">🪞 借鉴自这次灵感总结</p>
              <button
                type="button"
                onClick={() => {
                  setInspirationId(null);
                  setInspirationStyle(null);
                  // 同步清掉 URL 里的 inspirationId, 避免刷新页面又被自动应用
                  if (searchParams?.has('inspirationId')) {
                    const next = new URLSearchParams(searchParams.toString());
                    next.delete('inspirationId');
                    const qs = next.toString();
                    router.replace(qs ? `/agent?${qs}` : '/agent', { scroll: false });
                  }
                }}
                className="text-xs text-purple-700 hover:underline"
              >
                取消借鉴
              </button>
            </div>
            <div className="space-y-1 text-xs">
              {inspirationStyle.hookTypes.length > 0 && (
                <p>
                  <span className="text-muted-foreground">钩子: </span>
                  {inspirationStyle.hookTypes.slice(0, 3).map((h, i) => (
                    <span key={i} className="mr-1 rounded bg-white px-1.5 py-0.5 text-purple-900">
                      {h}
                    </span>
                  ))}
                </p>
              )}
              {inspirationStyle.titlePatterns.length > 0 && (
                <p>
                  <span className="text-muted-foreground">标题模式: </span>
                  {inspirationStyle.titlePatterns.slice(0, 3).map((t, i) => (
                    <span key={i} className="mr-1 rounded bg-white px-1.5 py-0.5 text-purple-900">
                      {t}
                    </span>
                  ))}
                </p>
              )}
              {inspirationStyle.durationInsight && (
                <p>
                  <span className="text-muted-foreground">时长: </span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-purple-900">
                    {inspirationStyle.durationInsight}
                  </span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label>选择平台</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {PLATFORMS.map((p) => {
                const active = p.value === platform;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatform(p.value)}
                    disabled={loading}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors',
                      active
                        ? 'border-transparent bg-brand-gradient text-white shadow-sm'
                        : 'border-border bg-card hover:bg-accent',
                    )}
                  >
                    <span className="text-2xl">{p.emoji}</span>
                    <span className="flex-1">
                      <span className="block font-semibold">{p.label}</span>
                      <span className={cn('block text-xs', active ? 'text-white/85' : 'text-muted-foreground')}>{p.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="topic">主题</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例: 如何用 ChatGPT 写周报"
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <Label>垂类</Label>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
              disabled={loading}
            >
              {KNOWN_NICHES.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
              <option value="__custom">其他 (自填)</option>
            </select>
            {niche === '__custom' && (
              <Input
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                placeholder="e.g. 健身, 二次元"
                disabled={loading}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Button onClick={handleGenerate} disabled={loading || topic.trim().length < 3} size="lg" variant="brand">
        {loading ? '生成中... (~10s)' : '生成 →'}
      </Button>

      {result && (
        <ScriptResult
          platform={platform}
          result={result}
          topic={topic.trim()}
          niche={effectiveNiche}
          onRegenerate={handleGenerate}
          ideaId={ideaId}
          cockpitId={cockpitId}
        />
      )}
    </div>
  );
}
