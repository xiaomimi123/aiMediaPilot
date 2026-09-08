'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * 「用这个模板出片」(三十五期)。
 *
 * 用户反馈原话: 点开模板库只有预设, 没办法生成视频。查证: 发起出片的
 * produce API 二十期就建好了, 但旧界面退役后, 全系统没有一条从界面发起
 * 出片的路 —— 模板编辑器右下角那句「在内容详情页的『剪辑』里选它发起」
 * 指的页面已经不存在了。
 *
 * 流程: 选一份六幕稿 → 发起 → 跳成片详情页。出镜链(talking-head-broll)
 * 建完任务不会自动开始 —— 要先在成片详情页上传口播视频(后端刻意的节奏,
 * 避免 worker 在素材还没上传时启动), 这里提示清楚, 免得用户以为卡住了。
 */
export interface DraftOption {
  id: string;
  topic: string;
  createdAt: string;
  /** 已出过几条片 —— 出过的排后面, 没出过的是更可能想出的 */
  producedCount: number;
}

export function ProducePanel({
  templateId,
  deliveryMode,
  drafts,
}: {
  templateId: string;
  deliveryMode: string;
  drafts: DraftOption[];
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function produce() {
    if (!draftId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/video-templates/${templateId}/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptDraftId: draftId }),
      });
      const body = (await res.json()) as { data?: { videoProductionId?: string }; message?: string };
      if (res.ok && body.data?.videoProductionId) {
        router.push(`/films/${body.data.videoProductionId}`);
      } else {
        // 失败必须露出来 —— 静默失败会让人以为点了没反应, 再点一次就是重复任务
        setError(body.message ?? `发起失败(HTTP ${res.status})`);
        setBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-md border border-primary/40 bg-card p-4">
      <h2 className="text-sm font-semibold">用这个模板出片</h2>
      {drafts.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          稿库里还没有六幕结构的稿子——出片吃的是六幕稿。先去「写稿」写一份，回来就能选。
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              className="min-w-0 max-w-full flex-1 rounded-md border border-input bg-card px-2 py-1.5 text-sm sm:max-w-md"
            >
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.topic.slice(0, 40)}
                  {` · ${d.createdAt}`}
                  {d.producedCount > 0 ? ` · 已出 ${d.producedCount} 条` : ''}
                </option>
              ))}
            </select>
            <Button disabled={busy || !draftId} onClick={() => void produce()}>
              {busy ? '发起中…' : '发起出片'}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {deliveryMode === 'talking-head-broll'
              ? '这是真人出镜模板：任务建好后不会自动开始，要先在成片详情页上传你拍的口播视频，上传完成自动开始渲染。'
              : '发起后自动排队渲染预览，完成后在成片详情页确认导出。'}
          </p>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </>
      )}
    </section>
  );
}
