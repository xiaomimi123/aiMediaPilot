"use client";
import { useEffect, useState } from "react";

interface VideoProductionState {
  id: string;
  status: string;
  previewPath: string | null;
  masterPath: string | null;
  errorMessage: string | null;
}

export function VideoProductionPanel({ contentId }: { contentId: string }) {
  const [vp, setVp] = useState<VideoProductionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/cockpit/video-productions/latest?contentId=${contentId}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled && json.success) setVp(json.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contentId]);

  useEffect(() => {
    if (!vp || ['done', 'failed'].includes(vp.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/cockpit/video-productions/${vp.id}`);
      const json = await res.json();
      if (json.success) setVp(json.data);
    }, 3000);
    return () => clearInterval(timer);
  }, [vp?.id, vp?.status]);

  async function start() {
    setLoading(true);
    const res = await fetch('/api/v1/cockpit/video-productions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentId }),
    });
    const json = await res.json();
    if (json.success) setVp({ id: json.data.id, status: json.data.status, previewPath: null, masterPath: null, errorMessage: null });
    setLoading(false);
  }

  async function approve() {
    if (!vp) return;
    await fetch(`/api/v1/cockpit/video-productions/${vp.id}/approve`, { method: 'POST' });
    setVp({ ...vp, status: 'approved' });
  }

  const STATUS_LABEL: Record<string, string> = {
    queued: '排队中', directing: '构思分镜中', building: '搭建画面中',
    assembling: '拼接预览中', preview_ready: '预览就绪', approved: '已确认，渲染正式成片中',
    rendering: '渲染正式成片中', done: '已完成', failed: '生成失败',
  };

  if (loading) return <p className="muted">加载中…</p>;
  if (!vp) return <button type="button" className="primary-button" onClick={start}>开始生成</button>;

  return <div className="video-production-panel">
    <div className="video-production-status"><strong>{STATUS_LABEL[vp.status] ?? vp.status}</strong></div>
    {vp.status === 'preview_ready' && vp.previewPath ? <>
      <video src={`/api/v1/cockpit/video-productions/${vp.id}/file?kind=preview`} controls className="video-production-preview" />
      <div className="video-production-actions">
        <button type="button" className="primary-button" onClick={approve}>确认导出</button>
        <button type="button" className="secondary-button" onClick={start}>重新生成</button>
      </div>
    </> : null}
    {vp.status === 'done' && vp.masterPath ? <a className="primary-button" href={`/api/v1/cockpit/video-productions/${vp.id}/file?kind=master`} download>下载成片</a> : null}
    {vp.status === 'failed' ? <>
      <p className="field-hint">{vp.errorMessage}</p>
      <button type="button" className="secondary-button" onClick={start}>重试</button>
    </> : null}
  </div>;
}
