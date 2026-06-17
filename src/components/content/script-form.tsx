'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';
import { ScriptResult } from './script-result';
import { cn } from '@/lib/utils';

export type Platform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';

const PLATFORMS: { value: Platform; label: string; emoji: string; sub: string }[] = [
  { value: 'douyin', label: '抖音', emoji: '🎬', sub: '短视频脚本 + 钩子 + 完播节奏' },
  { value: 'xiaohongshu', label: '小红书', emoji: '📕', sub: '图文笔记 + 标签 + 配图建议' },
  { value: 'gongzhonghao', label: '公众号', emoji: '📰', sub: '长文章 + 大纲 + 摘要' },
];

export function ScriptForm() {
  const [platform, setPlatform] = useState<Platform>('douyin');
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;

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
        body: JSON.stringify({ topic: topic.trim(), niche: effectiveNiche, platform }),
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
        />
      )}
    </div>
  );
}
