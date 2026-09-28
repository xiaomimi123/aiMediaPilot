'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VideoView } from '@/lib/benchmark/view';
import { VideoCard } from './video-card';
import { AccountPanel } from './account-panel';
import { SuggestPanel } from './suggest-panel';

export function TopicsView() {
  const [filter, setFilter] = useState<'hits' | 'all'>('hits');
  const [videos, setVideos] = useState<VideoView[] | null>(null);
  const [link, setLink] = useState('');
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/topics/videos?filter=${filter}`);
    const j = await res.json().catch(() => ({ success: false }));
    setVideos(j.success ? j.data : []);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  // 有拆解在跑时每 3 秒刷新
  useEffect(() => {
    if (!videos?.some((v) => v.analysisStatus === 'running')) return;
    const t = setTimeout(() => void load(), 3000);
    return () => clearTimeout(t);
  }, [videos, load]);

  const paste = async () => {
    setLinkBusy(true);
    setLinkMsg(null);
    const res = await fetch('/api/topics/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: link }) });
    const j = await res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
    setLinkBusy(false);
    if (!j.success) return setLinkMsg({ ok: false, text: j.message });
    setLink('');
    setLinkMsg({ ok: true, text: j.data.kind === 'video' ? '已加入，正在拆解（在「全部」里）' : '已关注这个博主' });
    if (j.data.kind === 'video') setFilter('all');
    await load();
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <SuggestPanel />
        <div className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="粘贴抖音分享链接（视频或博主主页）" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3 text-sm" disabled={linkBusy || !link.trim()} onClick={() => void paste()}>
            {linkBusy ? '读取中…' : '加入'}
          </button>
        </div>
        {linkMsg && <p className={`text-xs ${linkMsg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{linkMsg.text}</p>}
        <div className="flex gap-4 text-sm">
          {(['hits', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'} onClick={() => setFilter(f)}>
              {f === 'hits' ? '只看爆款' : '全部（近 30 天 + 拆过的）'}
            </button>
          ))}
        </div>
        {videos === null ? (
          <p className="text-sm text-[var(--text-secondary)]">加载中…</p>
        ) : videos.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            {filter === 'hits' ? '还没有对标爆款。先在「对标账号」里关注几个，每晚 20:30 巡检后这里会出现。' : '近 30 天没有对标作品。'}
          </p>
        ) : (
          <div className="space-y-3">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} onChanged={() => void load()} />
            ))}
          </div>
        )}
      </div>
      <AccountPanel onChanged={() => void load()} />
    </div>
  );
}
