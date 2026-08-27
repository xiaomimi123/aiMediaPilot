'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MATERIAL_LABELS, matchMaterials, type MaterialKind } from '@/lib/materials/model';

interface Row { id: string; kind: string; content: string; source: string; tags: string[] }

/**
 * 写稿页右栏的素材 tab —— 按**当前幕**检索。
 *
 * 一次取全量再在前端按幕过滤: 素材库是个人尺度的东西(几百条顶天), 切幕时不该
 * 每次都发一个请求。切幕是高频动作, 每次转圈会让人干脆不看这一栏。
 *
 * 一条都没匹配上就明说没有, **不退回展示"最近记的几条"** —— 无关素材摆在这里
 * 会诱导你把它写进稿子, 那比没有素材更糟。
 */
export function MaterialPanel({ narration, beats }: { narration: string; beats: string[] }) {
  const [all, setAll] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/materials')
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        const rows: Row[] = (b?.data?.materials ?? []).map((m: Row & { tags: unknown }) => ({
          ...m,
          tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
        }));
        setAll(rows);
      })
      .catch(() => setAll([]));
    return () => { alive = false; };
  }, []);

  if (all === null) return <p className="text-xs text-muted-foreground">素材加载中…</p>;

  if (all.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        素材库是空的。写到需要具体材料的地方，没有素材 AI 就会开始编——
        <Link href="/materials" className="underline underline-offset-4">先去记几条</Link>。
      </p>
    );
  }

  const hits = matchMaterials(all, { narration, beats });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {hits.length > 0 ? `这一幕匹配到 ${hits.length} 条` : `库里 ${all.length} 条，这一幕一条都没匹配上`}
      </p>

      {hits.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          说明这一幕写的内容你手里还没有具体材料。要么换个角度写你有素材的部分，要么先去记一条。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.slice(0, 8).map((m) => (
            <li key={m.id} className="rounded-md border border-border p-2">
              <p className="text-xs leading-relaxed">{m.content}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {MATERIAL_LABELS[m.kind as MaterialKind] ?? m.kind}
                {m.source ? ` · ${m.source}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
