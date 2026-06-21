'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';

type Platform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';
type PlatformFilter = 'all' | Platform;

const PLATFORM_LABEL: Record<Platform, string> = {
  douyin: '🎬 抖音',
  xiaohongshu: '📕 小红书',
  gongzhonghao: '📰 公众号',
};

interface VideoItem {
  id: string;
  platform: Platform;
  awemeId: string;
  videoUrl: string;
  authorName: string | null;
  title: string;
  playCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  shareCount: string | null;
  duration: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  userNote: string | null;
  fetchedAt: string;
}

interface InsightOutput {
  titlePatterns: string[];
  hookTypes: string[];
  durationInsight: string;
  topicClusters: string[];
  recommendedTopics: { title: string; rationale: string }[];
  summary: string;
}

interface InsightHistoryItem {
  id: string;
  videoIds: string[];
  output: InsightOutput;
  generatedAt: string;
}

function formatPlays(s: string | null): string {
  if (!s) return '—';
  const n = Number(s);
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export default function InspirationPage() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [insight, setInsight] = useState<{ id: string; output: InsightOutput } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [history, setHistory] = useState<InsightHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;

  const filteredItems =
    platformFilter === 'all' ? items : items.filter((v) => v.platform === platformFilter);
  const countByPlatform = items.reduce<Record<Platform, number>>(
    (acc, v) => {
      acc[v.platform] = (acc[v.platform] ?? 0) + 1;
      return acc;
    },
    { douyin: 0, xiaohongshu: 0, gongzhonghao: 0 },
  );

  async function refresh() {
    setLoading(true);
    try {
      const [v, h] = await Promise.all([
        fetch('/api/v1/inspiration/videos').then((r) => r.json()),
        fetch('/api/v1/inspiration/insights').then((r) => r.json()),
      ]);
      if (v.success) setItems(v.data.items);
      if (h.success) setHistory(h.data.items as InsightHistoryItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Fetch user's most-used niche as default selection
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
      .catch(() => {
        /* keep default */
      });
  }, []);

  const toggleSelected = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除这条灵感视频?')) return;
    await fetch(`/api/v1/inspiration/videos/${id}`, { method: 'DELETE' });
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    void refresh();
  };

  const handleGenerate = async () => {
    setGenerateError(null);
    setGenerating(true);
    try {
      const res = await fetch('/api/v1/inspiration/insights/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoIds: Array.from(selected),
          niche: effectiveNiche || 'ai-knowledge',
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setGenerateError(json.message);
      } else {
        setInsight({
          id: json.data.id as string,
          output: json.data.output as InsightOutput,
        });
        void refresh();
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📚 灵感视频库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          抖音自动抓 (粘 URL/分享文本); 小红书 / 公众号 手动填标题。 选 ≥ 2 条让 AI 总结共性。
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b">
        {([
          { key: 'all', label: '全部', count: items.length },
          { key: 'douyin', label: PLATFORM_LABEL.douyin, count: countByPlatform.douyin },
          { key: 'xiaohongshu', label: PLATFORM_LABEL.xiaohongshu, count: countByPlatform.xiaohongshu },
          { key: 'gongzhonghao', label: PLATFORM_LABEL.gongzhonghao, count: countByPlatform.gongzhonghao },
        ] as Array<{ key: PlatformFilter; label: string; count: number }>).map((t) => {
          const active = platformFilter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setPlatformFilter(t.key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              <span className="ml-1 text-xs text-muted-foreground">({t.count})</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setShowAdd(true)} variant="brand">
          <Plus className="mr-1 h-4 w-4" />
          添加视频 URL
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={selected.size < 2 || generating || !effectiveNiche}
          variant={selected.size >= 2 ? 'brand' : 'outline'}
        >
          <Sparkles className="mr-1 h-4 w-4" />
          {generating ? '分析中...' : `🧠 让 AI 总结这 ${selected.size || 0} 条共性`}
        </Button>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>按 niche:</span>
          <select
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            disabled={generating}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
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
              placeholder="自填 niche"
              disabled={generating}
              className="h-7 w-32 text-xs"
            />
          )}
        </div>
        {selected.size > 0 && (
          <span className="text-xs text-muted-foreground">已选 {selected.size} 条</span>
        )}
      </div>

      {generateError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          总结失败: {generateError}
        </div>
      )}

      {insight && (
        <InsightPanel data={insight.output} insightId={insight.id} onClose={() => setInsight(null)} />
      )}

      {history.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-medium">
                📜 历史总结 ({history.length} 条)
              </span>
              <span className="text-xs text-muted-foreground">
                {showHistory ? '收起 ↑' : '展开 ↓'}
              </span>
            </button>
            {showHistory && (
              <ul className="mt-4 space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(h.generatedAt).toLocaleString('zh-CN')} · 基于{' '}
                        {Array.isArray(h.videoIds) ? h.videoIds.length : 0} 条视频
                      </span>
                      <button
                        type="button"
                        onClick={() => setInsight({ id: h.id, output: h.output })}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        查看完整 →
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {h.output.summary}
                    </p>
                    {h.output.recommendedTopics?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {h.output.recommendedTopics.slice(0, 3).map((t, i) => (
                          <a
                            key={i}
                            href={`/agent?topic=${encodeURIComponent(t.title)}&platform=douyin&inspirationId=${h.id}`}
                            className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-900 hover:bg-purple-200"
                          >
                            {t.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-4 pt-8 pb-8 text-center">
            <p className="text-3xl">📥</p>
            <div className="space-y-1">
              <p className="text-base font-semibold">收第一条灵感视频</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                打开抖音 → 点分享 → 复制链接,直接粘到这里 (~30s 自动抓数据)。 小红书 / 公众号也支持
                (手动填标题)。
              </p>
            </div>
            <Button onClick={() => setShowAdd(true)} variant="brand" size="lg">
              <Plus className="mr-1 h-4 w-4" />
              添加第一条
            </Button>
            <p className="text-xs text-muted-foreground">
              提示: 至少 2 条同类型视频才能调用 AI 总结
            </p>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center text-sm text-muted-foreground">
            当前平台下还没有视频
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((v) => {
            const isSelected = selected.has(v.id);
            return (
              <Card
                key={v.id}
                className={cn(
                  'cursor-pointer transition-all',
                  isSelected ? 'border-2 border-blue-500 shadow-md' : 'hover:shadow-sm',
                )}
                onClick={() => toggleSelected(v.id)}
              >
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center text-xs',
                        isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-border',
                      )}
                    >
                      {isSelected && '✓'}
                    </span>
                    <h3 className="flex-1 line-clamp-2 text-sm font-medium">{v.title}</h3>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(v.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      {PLATFORM_LABEL[v.platform] ?? v.platform}
                    </span>
                    {v.authorName && <span>@{v.authorName}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>▶ {formatPlays(v.playCount)}</span>
                    <span>♥ {formatPlays(v.likeCount)}</span>
                    <span>💬 {formatPlays(v.commentCount)}</span>
                    {v.duration && <span>⏱ {v.duration}s</span>}
                  </div>
                  {v.userNote && (
                    <p className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                      📝 {v.userNote}
                    </p>
                  )}
                  <a
                    href={v.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="block text-xs text-blue-600 hover:underline"
                  >
                    原视频 →
                  </a>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && <AddVideoModal onClose={() => setShowAdd(false)} onAdded={refresh} />}
    </div>
  );
}

function InsightPanel({
  data,
  insightId,
  onClose,
}: {
  data: InsightOutput;
  insightId: string | null;
  onClose: () => void;
}) {
  return (
    <Card className="border-2 border-purple-300 bg-purple-50/30">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🧠 AI 总结的共性 + 推荐 topic</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <Section title="📝 标题模式">
          <ul className="ml-4 list-disc space-y-1 text-sm">
            {data.titlePatterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Section>

        <Section title="🪝 钩子类型分布">
          <div className="flex flex-wrap gap-1.5">
            {data.hookTypes.map((h, i) => (
              <span key={i} className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-900">
                {h}
              </span>
            ))}
          </div>
        </Section>

        <Section title="⏱ 时长规律">
          <p className="text-sm">{data.durationInsight}</p>
        </Section>

        <Section title="📂 主题聚类">
          <div className="flex flex-wrap gap-1.5">
            {data.topicClusters.map((t, i) => (
              <span key={i} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
                {t}
              </span>
            ))}
          </div>
        </Section>

        <Section title="🚀 推荐你下一步可做的 topic">
          <ol className="space-y-3 text-sm">
            {data.recommendedTopics.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium">
                      {i + 1}. {t.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{t.rationale}</p>
                  </div>
                  <a
                    href={`/agent?topic=${encodeURIComponent(t.title)}&platform=douyin${insightId ? `&inspirationId=${insightId}` : ''}`}
                    className="shrink-0 rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    用这个生成 →
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="📋 总结">
          <p className="whitespace-pre-wrap text-sm">{data.summary}</p>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function detectClientPlatform(input: string): { platform: Platform | null; isShortLink: boolean } {
  const t = input.trim();
  if (!t) return { platform: null, isShortLink: false };
  if (/douyin\.com|iesdouyin\.com/.test(t)) {
    return { platform: 'douyin', isShortLink: /v\.douyin\.com/.test(t) };
  }
  if (/xiaohongshu\.com|xhslink\.com/.test(t)) {
    return { platform: 'xiaohongshu', isShortLink: /xhslink\.com/.test(t) };
  }
  if (/mp\.weixin\.qq\.com/.test(t)) return { platform: 'gongzhonghao', isShortLink: false };
  if (/^\d{15,25}$/.test(t)) return { platform: 'douyin', isShortLink: false };
  return { platform: null, isShortLink: false };
}

function AddVideoModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [userNote, setUserNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const detected = detectClientPlatform(url);
  const forceManual = detected.platform !== null && detected.platform !== 'douyin';
  const showManualForm = showManual || forceManual;

  // Manual fields
  const [mTitle, setMTitle] = useState('');
  const [mAuthor, setMAuthor] = useState('');
  const [mPlays, setMPlays] = useState('');
  const [mLikes, setMLikes] = useState('');
  const [mComments, setMComments] = useState('');
  const [mDuration, setMDuration] = useState('');

  const submit = async (withManual: boolean) => {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { url: url.trim(), userNote: userNote.trim() };
      if (withManual) {
        body.manualMetadata = {
          title: mTitle.trim(),
          authorName: mAuthor.trim() || undefined,
          playCount: mPlays ? Number(mPlays) : undefined,
          likeCount: mLikes ? Number(mLikes) : undefined,
          commentCount: mComments ? Number(mComments) : undefined,
          durationSec: mDuration ? Number(mDuration) : undefined,
        };
      }
      const res = await fetch('/api/v1/inspiration/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        onAdded();
        onClose();
        return;
      }
      // 422 → 自动抓取失败, 需要手动
      if (res.status === 422) {
        setShowManual(true);
        setError(json.message);
      } else {
        setError(json.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">添加灵感视频</h3>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="url">视频 URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="抖音 / 小红书 / 公众号 链接或分享文本"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              {detected.platform === 'douyin' && '🎬 抖音 — 系统会自动抓数据'}
              {detected.platform === 'xiaohongshu' && '📕 小红书 — 无 crawler, 请手动填标题'}
              {detected.platform === 'gongzhonghao' && '📰 公众号 — 无 crawler, 请手动填标题'}
              {detected.platform === null && '支持抖音 / 小红书 / 公众号 URL 或分享文本'}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="note">我的笔记 (可选)</Label>
            <Input
              id="note"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="例: 钩子很强 / 标题用法记下"
              disabled={saving}
            />
          </div>

          {showManualForm && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">
                {forceManual
                  ? `${detected.platform === 'xiaohongshu' ? '📕 小红书' : '📰 公众号'} 无 crawler, 请手动填:`
                  : '⚠️ 自动抓取没拿到数据, 请手动填:'}
              </p>
              <div className="space-y-1">
                <Label htmlFor="m-title">标题 (必填)</Label>
                <Input id="m-title" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="m-author">作者</Label>
                  <Input id="m-author" value={mAuthor} onChange={(e) => setMAuthor(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-plays">播放数</Label>
                  <Input id="m-plays" type="number" value={mPlays} onChange={(e) => setMPlays(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-likes">点赞</Label>
                  <Input id="m-likes" type="number" value={mLikes} onChange={(e) => setMLikes(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m-comments">评论</Label>
                  <Input id="m-comments" type="number" value={mComments} onChange={(e) => setMComments(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="m-duration">时长 (秒)</Label>
                  <Input id="m-duration" type="number" value={mDuration} onChange={(e) => setMDuration(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            {!showManualForm ? (
              <Button onClick={() => submit(false)} disabled={!url.trim() || saving} variant="brand">
                {saving ? '抓取中...' : '抓取并添加'}
              </Button>
            ) : (
              <Button onClick={() => submit(true)} disabled={!mTitle.trim() || saving} variant="brand">
                {saving ? '保存中...' : '保存'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
