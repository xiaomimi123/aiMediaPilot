'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles } from 'lucide-react';
import { KNOWN_NICHES } from '@/lib/llm/prompts';
import { cn } from '@/lib/utils';
import { CONTENT_PLATFORMS, CONTENT_PLATFORM_LABEL, type ContentPlatform } from '@/lib/platform';

interface DiscoveredTopic {
  title: string;
  hookType: string;
  hookLine: string;
  rationale: string;
  difficulty: 'low' | 'med' | 'high';
  targetAudience: string;
}

interface DiscoveryResult {
  niche: string;
  generatedAt: string;
  dedupSampleSize: number;
  topics: DiscoveredTopic[];
  summary: string;
}

const DIFFICULTY_BADGE: Record<DiscoveredTopic['difficulty'], { label: string; cls: string }> = {
  low: { label: '低门槛 · 1h', cls: 'bg-green-100 text-green-900' },
  med: { label: '中等 · 半天', cls: 'bg-blue-100 text-blue-900' },
  high: { label: '高门槛 · 1+天', cls: 'bg-amber-100 text-amber-900' },
};

const PLATFORMS = CONTENT_PLATFORMS.map((value) => ({
  value,
  label: CONTENT_PLATFORM_LABEL[value],
}));

export default function DiscoverPage() {
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const [count, setCount] = useState(12);
  const [extraHint, setExtraHint] = useState('');
  const [platform, setPlatform] = useState<ContentPlatform>('douyin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [savedIndices, setSavedIndices] = useState<Record<number, boolean>>({});
  const [savingIndices, setSavingIndices] = useState<Record<number, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});

  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;

  useEffect(() => {
    fetch('/api/v1/user/default-niche')
      .then((r) => r.json())
      .then((j) => {
        if (j.success && typeof j.data.niche === 'string') {
          const found = KNOWN_NICHES.find((n) => n.key === j.data.niche);
          if (found) setNiche(j.data.niche);
          else {
            setNiche('__custom');
            setCustomNiche(j.data.niche);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerate = async () => {
    setError(null);
    if (!effectiveNiche) {
      setError('请选 niche');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/discover/topics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          niche: effectiveNiche,
          count,
          ...(extraHint.trim() ? { extraHint: extraHint.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
      } else {
        setResult(json.data as DiscoveryResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToPool = async (index: number, t: DiscoveredTopic) => {
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setSavingIndices((prev) => ({ ...prev, [index]: true }));
    try {
      const res = await fetch('/api/v1/cockpit/inspirations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `${t.title}\n${t.hookLine}\n${t.rationale}` }),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveErrors((prev) => ({ ...prev, [index]: json.message }));
      } else {
        setSavedIndices((prev) => ({ ...prev, [index]: true }));
      }
    } catch (e) {
      setSaveErrors((prev) => ({ ...prev, [index]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSavingIndices((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">AI 主题发现</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          没有选题灵感? 系统基于你的 niche + 已写过的 topic, 一次给你 5-20 个**可立刻上手**的选题候选,
          每条带钩子草稿 + 流量理由 + 难度估计。 一键跳生成脚本.
        </p>
      </div>

      <Card className="border-[var(--line)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Niche (赛道)</Label>
              <select
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
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
                  placeholder="e.g. 健身, 旅游"
                  disabled={loading}
                />
              )}
            </div>

            <div className="space-y-1">
              <Label>生成数量</Label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                disabled={loading}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
              >
                <option value={5}>5 个</option>
                <option value={8}>8 个</option>
                <option value={12}>12 个 (推荐)</option>
                <option value={20}>20 个</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label>目标平台 (影响跳转)</Label>
              <div className="flex gap-1">
                {PLATFORMS.map((p) => {
                  const active = p.value === platform;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPlatform(p.value)}
                      disabled={loading}
                      className={cn(
                        'flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
                        active
                          ? 'border-[var(--clay)] bg-[var(--clay-soft)] text-[#984629]'
                          : 'border-[var(--line)] hover:bg-[var(--hover-bg)]',
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>额外要求 (可选)</Label>
              <span
                className={cn(
                  'text-[10px] tabular-nums',
                  extraHint.length > 200 ? 'text-destructive' : 'text-[var(--muted)]',
                )}
              >
                {extraHint.length}/200
              </span>
            </div>
            <Input
              value={extraHint}
              onChange={(e) => setExtraHint(e.target.value.slice(0, 200))}
              placeholder="例: 想要更偏新人入门 / 偏实操对比 / 想结合最近 AI agents 趋势"
              maxLength={200}
              disabled={loading}
            />
          </div>

          <Button onClick={handleGenerate} disabled={loading || !effectiveNiche} size="lg" variant="brand">
            <Sparkles className="mr-1.5 h-4 w-4" />
            {loading ? '生成中... (~15s)' : `让 AI 想 ${count} 个选题`}
          </Button>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card className="border-[var(--clay)]/30 bg-[var(--clay-soft)]/30">
            <CardContent className="space-y-2 pt-5">
              <p className="text-sm font-medium text-[#8f3f28]">本批整体方向</p>
              <p className="text-sm text-[var(--ink)]">{result.summary}</p>
              <p className="text-xs text-[var(--muted)]">
                niche: {result.niche} · 生成于{' '}
                {new Date(result.generatedAt).toLocaleString('zh-CN')}
                {result.dedupSampleSize > 0 && ` · 已跟你最近 ${result.dedupSampleSize} 条脚本去重`}
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.topics.map((t, i) => {
              const diff = DIFFICULTY_BADGE[t.difficulty];
              const saved = Boolean(savedIndices[i]);
              const saving = Boolean(savingIndices[i]);
              return (
                <Card key={i} className="border-[var(--line)] bg-[var(--panel-bg)] transition-shadow hover:shadow-md">
                  <CardContent className="space-y-2.5 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="flex-1 text-sm font-semibold leading-snug text-[var(--ink)]">
                        {i + 1}. {t.title}
                      </h3>
                      <span className={cn('shrink-0 rounded px-2 py-0.5 text-[10px] font-medium', diff.cls)}>
                        {diff.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                        {t.hookType}
                      </span>
                      <span className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-[var(--muted)]">
                        {t.targetAudience}
                      </span>
                    </div>

                    <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
                      <span className="font-medium">钩子: </span>
                      {t.hookLine}
                    </div>

                    <p className="text-xs text-[var(--muted)]">{t.rationale}</p>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveToPool(i, t)}
                        disabled={saved || saving}
                        className="inline-block rounded-md border border-[#d6b6a8] bg-[var(--clay-soft)] px-3 py-1.5 text-xs font-medium text-[#8f3f28] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saved ? '已存入 ✓' : saving ? '存入中…' : '存入灵感池'}
                      </button>
                    </div>
                    {saveErrors[i] && (
                      <p className="text-xs text-destructive">{saveErrors[i]}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
