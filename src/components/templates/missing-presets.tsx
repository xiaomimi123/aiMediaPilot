'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { VideoTemplateConfig } from '@/lib/video-template/model';

/**
 * 「你还缺这几个内置预设」(二十三期)。
 *
 * **动因是一次真实事故, 代价很大。** 对标参考片的「真人口播 · 文字叠加」预设一直
 * 躺在代码里, 但从没进过用户的数据库 —— 播种只在「一条模板都没有」时发生, 而用户
 * 早就有 4 条。于是十几轮出片全跑在带 B-roll 的模板上, 而参考片实测 49 帧全是真人
 * 实拍、一帧 B-roll 都没有: **方向从第一轮就错了, 而界面上看不出任何异常。**
 *
 * 所以这一块不做成折叠区、也不藏在设置里: 它是「你手上的工具和你想要的效果对不上」
 * 这件事的唯一提示。
 */
export function MissingPresets({ presets }: { presets: VideoTemplateConfig[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (presets.length === 0) return null;

  async function add(preset: VideoTemplateConfig) {
    setBusy(preset.name);
    setError('');
    try {
      const res = await fetch('/api/v1/video-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preset),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) { setError(body?.message ?? '添加失败'); return; }
      router.refresh();
    } catch {
      setError('添加失败，请检查网络');
    } finally { setBusy(''); }
  }

  return (
    <section className="mb-5 rounded-md border border-border bg-secondary/40 p-3.5">
      <p className="text-sm font-medium">还有 {presets.length} 个内置预设没加进来</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        预设只在你<span className="text-foreground">一个模板都没有</span>的时候自动播种，
        之后新增的就到不了你手上了——不点这里，你不会知道它们存在。
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        {presets.map((p) => (
          <li key={p.name} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">{p.name}</p>
              {p.description ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {p.description.split('\n').join(' · ')}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== ''}
              onClick={() => void add(p)}
            >
              {busy === p.name ? '添加中…' : '加进来'}
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
