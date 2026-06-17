'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate-douyin';
import { ScriptResult } from './script-result';

export function ScriptForm() {
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptGenerateResponse | null>(null);

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
        body: JSON.stringify({ topic: topic.trim(), niche: effectiveNiche }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
      } else {
        setResult(json.data as ScriptGenerateResponse);
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
        {loading ? '生成中... (~10s)' : '生成脚本 →'}
      </Button>

      {result && (
        <ScriptResult
          result={result}
          topic={topic.trim()}
          niche={effectiveNiche}
          onRegenerate={handleGenerate}
        />
      )}
    </div>
  );
}
