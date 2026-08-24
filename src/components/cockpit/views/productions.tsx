"use client";

import { useCallback, useEffect, useState } from "react";
import { PRODUCTION_STATUS_LABELS, DELIVERY_MODE_LABELS } from "@/components/cockpit/views/templates";

interface LibraryProduction {
  id: string;
  status: string;
  mode: string;
  masterPath: string | null;
  previewPath: string | null;
  contentId: string;
  templateId: string | null;
  createdAt: string;
  errorMessage: string | null;
  contentTitle: string | null;
  templateName: string | null;
}

function fileUrl(id: string, kind: "preview" | "master"): string {
  return `/api/v1/cockpit/video-productions/${id}/file?type=${kind}`;
}

function formatTime(iso: string): string {
  // createdAt 是 ISO 字符串; 解析不了就原样显示, 不因为一条脏数据让整页崩。
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 成片库(二十一期)。真实使用暴露: 片子生成成功了但界面上没有任何路径能通向它——
 * 模板页的历史列表藏在出片向导内页, 且只在 masterPath 存在时给链接, 预览就绪的
 * 任务(只有 previewPath)在列表里就是一行干瘪的状态文字。这个板块把全部任务
 * (含内容详情页旧入口发起的)摆在一处, 并**就地播放**而不是逼用户下载。
 */
export function ProductionsView() {
  const [productions, setProductions] = useState<LibraryProduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; kind: "preview" | "master" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/video-productions");
      const body = await res.json();
      if (!body?.data?.productions) throw new Error(body?.message || "返回数据异常");
      setProductions(body.data.productions as LibraryProduction[]);
    } catch (e) {
      setError(e instanceof Error ? `成片库加载失败：${e.message}` : "成片库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <section className="page productions-page">
    <div className="page-heading">
      <span className="eyebrow">LIBRARY</span>
      <h1>成片</h1>
      <p>这里汇总你所有的视频生成任务，可以直接播放，不用下载到本地再打开。</p>
    </div>

    {error ? <p className="validation-note">{error}</p> : null}
    {loading && !productions.length ? <p>加载中…</p> : null}

    {!loading && !error && !productions.length
      ? <section className="panel"><p>还没有任何视频任务。去「模板」板块选一个模板出第一条片子。</p></section>
      : null}

    <ul className="production-list">
      {productions.map((p) => {
        const canPreview = Boolean(p.previewPath);
        const canMaster = Boolean(p.masterPath);
        const isPlaying = playing?.id === p.id;
        return <li key={p.id} className="panel production-card">
          <div className="production-card-heading">
            <h2>{p.contentTitle ?? "(内容已删除)"}</h2>
            <span className="badge">{PRODUCTION_STATUS_LABELS[p.status] ?? p.status}</span>
          </div>
          <p className="production-card-meta">
            {DELIVERY_MODE_LABELS[p.mode] ?? p.mode}
            {p.templateName ? ` · 模板：${p.templateName}` : " · 内容详情页发起"}
            {` · ${formatTime(p.createdAt)}`}
          </p>

          {p.status === "failed" && p.errorMessage
            ? <p className="validation-note">{p.errorMessage}</p>
            : null}

          <div className="production-card-actions">
            {canPreview
              ? <button type="button" className="secondary-button" onClick={() => setPlaying({ id: p.id, kind: "preview" })}>看预览</button>
              : null}
            {canMaster
              ? <button type="button" className="primary-button" onClick={() => setPlaying({ id: p.id, kind: "master" })}>看成片</button>
              : null}
            {canMaster
              ? <a href={fileUrl(p.id, "master")} target="_blank" rel="noreferrer">下载</a>
              : null}
          </div>

          {isPlaying
            ? <video className="production-player" src={fileUrl(p.id, playing.kind)} controls autoPlay />
            : null}
        </li>;
      })}
    </ul>
  </section>;
}
