'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DouyinListItem {
  awemeId: string;
  postedAt: string;
  plays: string;
  desc: string;
}

interface UnmatchedAnalysis {
  id: string;
  videoFilename: string;
  draftTitle: string | null;
  createdAt: string;
}

export function RetroSyncTable({ unmatched }: { unmatched: UnmatchedAnalysis[] }) {
  const router = useRouter();
  const [items, setItems] = useState<DouyinListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<
    Record<string, { selectedAnalysisId: string; status: 'idle' | 'matching' | 'done' | 'error'; error?: string }>
  >({});

  const handleRefresh = async () => {
    setLoading(true);
    setBannerError(null);
    try {
      const res = await fetch('/api/v1/douyin/list');
      const json = await res.json();
      if (!json.success) {
        setBannerError(json.message);
      } else {
        setItems(json.data);
        setLastFetchAt(new Date().toLocaleString());
      }
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleMatch = async (awemeId: string, item: DouyinListItem) => {
    const state = rowState[awemeId];
    const analysisId = state?.selectedAnalysisId ?? unmatched[0]?.id;
    if (!analysisId) return;
    setRowState((s) => ({ ...s, [awemeId]: { selectedAnalysisId: analysisId, status: 'matching' } }));
    try {
      const res = await fetch(`/api/v1/content/analyses/${analysisId}/match-douyin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ awemeId, postedAt: item.postedAt, plays: item.plays, desc: item.desc }),
      });
      const json = await res.json();
      if (!json.success) {
        setRowState((s) => ({
          ...s,
          [awemeId]: { selectedAnalysisId: analysisId, status: 'error', error: json.message },
        }));
      } else {
        setRowState((s) => ({ ...s, [awemeId]: { selectedAnalysisId: analysisId, status: 'done' } }));
        router.refresh();
      }
    } catch (e) {
      setRowState((s) => ({
        ...s,
        [awemeId]: {
          selectedAnalysisId: analysisId,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  if (unmatched.length === 0 && !items) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm">无未匹配的分析。</p>
          <p className="text-xs text-muted-foreground">
            所有 COMPLETED 分析都已匹配抖音视频, 无需同步。 上传新分析后再来。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button onClick={handleRefresh} disabled={loading}>
          {loading ? '加载中...' : '🔄 刷新抖音列表'}
        </Button>
        {lastFetchAt && (
          <div className="text-xs text-muted-foreground">
            最后刷新: {lastFetchAt} · {items?.length ?? 0} 条
          </div>
        )}
      </div>

      {bannerError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          抖音列表拉取失败: {bannerError}
        </div>
      )}

      {items === null && !bannerError && (
        <p className="text-sm text-muted-foreground">点 &ldquo;刷新抖音列表&rdquo; 拉取近期 20 条视频。</p>
      )}

      {items?.length === 0 && <p className="text-sm text-muted-foreground">无最近视频。</p>}

      {items && items.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">aweme</th>
                  <th className="py-2 text-left">发布</th>
                  <th className="py-2 text-right">播放</th>
                  <th className="py-2 text-left">描述</th>
                  <th className="py-2 text-left">匹配</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const state =
                    rowState[item.awemeId] ?? { selectedAnalysisId: unmatched[0]?.id ?? '', status: 'idle' };
                  return (
                    <tr key={item.awemeId} className="border-b align-top">
                      <td className="py-2 font-mono text-xs">{item.awemeId.slice(0, 10)}...</td>
                      <td className="py-2 text-xs">{item.postedAt}</td>
                      <td className="py-2 text-right tabular-nums">{item.plays}</td>
                      <td className="py-2 max-w-xs truncate">{item.desc || '—'}</td>
                      <td className="py-2 space-y-1">
                        {state.status === 'done' ? (
                          <Link
                            href={`/content/preflight/${state.selectedAnalysisId}`}
                            className="text-xs text-green-700 hover:underline"
                          >
                            ✓ 已匹配并复盘中 →
                          </Link>
                        ) : unmatched.length === 0 ? (
                          <span className="text-xs text-muted-foreground">无未匹配分析</span>
                        ) : (
                          <>
                            <select
                              value={state.selectedAnalysisId}
                              onChange={(e) =>
                                setRowState((s) => ({
                                  ...s,
                                  [item.awemeId]: { ...state, selectedAnalysisId: e.target.value },
                                }))
                              }
                              className="w-full rounded border border-border bg-background p-1 text-xs"
                              disabled={state.status === 'matching'}
                            >
                              {unmatched.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.videoFilename}
                                  {a.draftTitle ? ` · ${a.draftTitle.slice(0, 20)}` : ''}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() => handleMatch(item.awemeId, item)}
                              disabled={state.status === 'matching'}
                              className="w-full"
                            >
                              {state.status === 'matching' ? '匹配中...' : '匹配并复盘 →'}
                            </Button>
                            {state.error && (
                              <p
                                className={cn(
                                  'text-xs',
                                  state.error.includes('已') ? 'text-amber-700' : 'text-destructive',
                                )}
                              >
                                {state.error}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
