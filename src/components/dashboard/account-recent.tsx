'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface AccountRecentVideo {
  awemeId: string;
  desc: string;
  createTime: number;
  durationMs: number;
  playCount: number;
  diggCount: number;
  commentCount: number;
}

function fmtPlays(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function fmtDate(unixSec: number): string {
  if (!unixSec) return '—';
  const d = new Date(unixSec * 1000);
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${m}-${day}`;
}

export function AccountRecent() {
  const [videos, setVideos] = useState<AccountRecentVideo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/account/recent?limit=5${force ? '&force=1' : ''}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        setVideos(null);
      } else {
        setVideos(json.data.videos);
        setFetchedAt(json.data.fetchedAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🎬 我的抖音 · 最近 5 条</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load(videos !== null)}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {videos === null ? '加载真实数据' : loading ? '抓取中…' : '刷新'}
          </Button>
        </div>

        {videos === null && !error && !loading && (
          <p className="mt-4 text-xs text-muted-foreground">
            从抖音创作者中心拉真实数据 (~30s, Playwright 驱动)。 点 [加载真实数据] 开始.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {videos && videos.length === 0 && (
          <p className="mt-4 text-xs text-muted-foreground">账号下没有视频</p>
        )}

        {videos && videos.length > 0 && (
          <>
            <ul className="mt-3 space-y-2 text-sm">
              {videos.map((v) => (
                <li key={v.awemeId} className="flex items-start gap-2 border-b pb-2 last:border-b-0">
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {fmtDate(v.createTime)}
                  </span>
                  <a
                    href={`https://www.douyin.com/video/${v.awemeId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate hover:text-primary"
                    title={v.desc}
                  >
                    {v.desc || '(无标题)'}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ▶ {fmtPlays(v.playCount)} · ♥ {fmtPlays(v.diggCount)}
                  </span>
                </li>
              ))}
            </ul>
            {fetchedAt && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                抓取于 {new Date(fetchedAt).toLocaleString('zh-CN')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
