'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { KNOWN_NICHES } from '@/lib/llm/prompts';
import {
  type Platform,
  type PlatformFilter,
  type VideoItem,
  type InsightOutput,
  type InsightHistoryItem,
  PLATFORM_LABEL,
  formatPlays,
} from '@/components/inspiration/types';
import { InsightPanel } from '@/components/inspiration/insight-panel';
import { AddVideoModal } from '@/components/inspiration/add-video-modal';

export default function InspirationPage() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [insight, setInsight] = useState<{ id: string; output: InsightOutput } | null>(null);
  const [insightCollapsed, setInsightCollapsed] = useState(false);
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

  const visibleSelectedCount = filteredItems.filter((v) => selected.has(v.id)).length;
  const allVisibleSelected =
    filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;

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

  const toggleSelectAllVisible = () => {
    setSelected((s) => {
      const next = new Set(s);
      if (allVisibleSelected) {
        filteredItems.forEach((v) => next.delete(v.id));
      } else {
        filteredItems.forEach((v) => next.add(v.id));
      }
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

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确认删除 ${selected.size} 条灵感视频? 不可恢复`)) return;
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/v1/inspiration/videos/${id}`, { method: 'DELETE' }).catch(() => null),
      ),
    );
    setSelected(new Set());
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
        setInsightCollapsed(false);
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
        <p className="mt-1 text-sm text-[var(--muted)]">
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
                  ? 'border-[var(--clay)] font-medium text-[var(--ink)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]',
              )}
            >
              {t.label}
              <span className="ml-1 text-xs text-[var(--muted)]">({t.count})</span>
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
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>按 niche:</span>
          <select
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            disabled={generating}
            className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs"
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
      </div>

      {/* 批量操作条 — 只在有视频时显示 */}
      {filteredItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-xs">
          <button
            type="button"
            onClick={toggleSelectAllVisible}
            className="font-medium text-[var(--ink)] hover:underline"
          >
            {allVisibleSelected ? '☑️ 反选当前页' : '☐ 全选当前页'}
          </button>
          <span className="text-[var(--muted)]">·</span>
          <span className="text-[var(--muted)]">已选 {selected.size} 条</span>
          {selected.size > 0 && (
            <>
              <span className="text-[var(--muted)]">·</span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[var(--muted)] hover:underline"
              >
                清空选择
              </button>
              <span className="text-[var(--muted)]">·</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                className="text-destructive hover:underline"
              >
                🗑 删除已选 ({selected.size})
              </button>
            </>
          )}
        </div>
      )}

      {generateError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          总结失败: {generateError}
        </div>
      )}

      {/* InsightPanel + collapsed banner */}
      {insight && !insightCollapsed && (
        <InsightPanel
          data={insight.output}
          insightId={insight.id}
          onClose={() => setInsightCollapsed(true)}
        />
      )}
      {insight && insightCollapsed && (
        <button
          type="button"
          onClick={() => setInsightCollapsed(false)}
          className="flex w-full items-center justify-between rounded-lg border-2 border-[var(--clay)]/30 bg-[var(--clay-soft)]/40 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--clay-soft)]"
        >
          <span className="font-medium text-[#8f3f28]">
            🧠 上次 AI 总结已折叠 — 点击展开
          </span>
          <span className="text-xs text-[var(--muted)]">展开 ↓</span>
        </button>
      )}

      {history.length > 0 && (
        <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
          <CardContent className="pt-6">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-medium">
                📜 历史总结 ({history.length} 条)
              </span>
              <span className="text-xs text-[var(--muted)]">
                {showHistory ? '收起 ↑' : '展开 ↓'}
              </span>
            </button>
            {showHistory && (
              <ul className="mt-4 space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted)]">
                        {new Date(h.generatedAt).toLocaleString('zh-CN')} · 基于{' '}
                        {Array.isArray(h.videoIds) ? h.videoIds.length : 0} 条视频
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setInsight({ id: h.id, output: h.output });
                          setInsightCollapsed(false);
                        }}
                        className="text-xs text-[var(--clay)] hover:underline"
                      >
                        查看完整 →
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">
                      {h.output.summary}
                    </p>
                    {h.output.recommendedTopics?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {h.output.recommendedTopics.slice(0, 3).map((t, i) => (
                          <a
                            key={i}
                            href={`/content/script/new?topic=${encodeURIComponent(t.title)}&platform=douyin&inspirationId=${h.id}`}
                            className="rounded bg-[var(--clay-soft)] px-2 py-0.5 text-xs text-[#984629] hover:bg-[#ead0c2]"
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
        <p className="text-sm text-[var(--muted)]">加载中...</p>
      ) : items.length === 0 ? (
        <Card className="border-dashed border-[var(--line-dark)] bg-[var(--panel-bg)]">
          <CardContent className="space-y-4 pt-8 pb-8 text-center">
            <p className="text-3xl">📥</p>
            <div className="space-y-1">
              <p className="text-base font-semibold">收第一条灵感视频</p>
              <p className="mx-auto max-w-md text-sm text-[var(--muted)]">
                打开抖音 → 点分享 → 复制链接,直接粘到这里 (~30s 自动抓数据)。 小红书 / 公众号也支持
                (手动填标题)。
              </p>
            </div>
            <Button onClick={() => setShowAdd(true)} variant="brand" size="lg">
              <Plus className="mr-1 h-4 w-4" />
              添加第一条
            </Button>
            <p className="text-xs text-[var(--muted)]">
              提示: 至少 2 条同类型视频才能调用 AI 总结
            </p>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
          <CardContent className="space-y-2 pt-6 text-center text-sm text-[var(--muted)]">
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
                  'cursor-pointer border-[var(--line)] bg-[var(--panel-bg)] transition-all',
                  isSelected ? 'border-2 border-[var(--clay)] shadow-md' : 'hover:shadow-sm',
                )}
                onClick={() => toggleSelected(v.id)}
              >
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center text-xs',
                        isSelected ? 'border-[var(--clay)] bg-[var(--clay)] text-white' : 'border-[var(--line)]',
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
                      className="text-[var(--muted)] hover:text-destructive"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-[10px]">
                      {PLATFORM_LABEL[v.platform] ?? v.platform}
                    </span>
                    {v.authorName && <span>@{v.authorName}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)] tabular-nums">
                    <span>▶ {formatPlays(v.playCount)}</span>
                    <span>♥ {formatPlays(v.likeCount)}</span>
                    <span>💬 {formatPlays(v.commentCount)}</span>
                    {v.duration && <span>⏱ {v.duration}s</span>}
                  </div>
                  {v.userNote && (
                    <p className="rounded bg-[var(--surface-soft)] px-2 py-1 text-xs text-[var(--muted)]">
                      📝 {v.userNote}
                    </p>
                  )}
                  <a
                    href={v.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="block text-xs text-[var(--clay)] hover:underline"
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
