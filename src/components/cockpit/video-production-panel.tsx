"use client";
import { useEffect, useState } from "react";
import type { DeliveryMode } from "@/lib/cockpit/model";

interface VideoProductionState {
  id: string;
  status: string;
  previewPath: string | null;
  masterPath: string | null;
  errorMessage: string | null;
}

export function VideoProductionPanel({ contentId, deliveryMode }: { contentId: string; deliveryMode: DeliveryMode }) {
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
    queued: '排队中', source_uploaded: '视频已上传，等待生成', directing: '构思分镜中', building: '搭建画面中',
    assembling: '拼接预览中', preview_ready: '预览就绪', approved: '已确认，渲染正式成片中',
    rendering: '渲染正式成片中', done: '已完成', failed: '生成失败',
  };

  // talking-head-broll 的生成必须先在「录制」步骤上传出镜视频(该上传本身会创建
  // VideoProduction 记录并在写入 sourceVideoPath 后自动入队)——所以这里 vp 为空
  // 就意味着还没上传, "开始生成"没有意义(点了也只会创建一条没有源视频、worker
  // 会立即报"尚未上传出镜视频"的僵尸记录), 禁用并提示去录制步骤上传。
  const needsUploadFirst = deliveryMode === 'talking-head-broll' && !vp;

  if (loading) return <p className="muted">加载中…</p>;
  if (needsUploadFirst) return <div className="video-production-panel">
    <button type="button" className="primary-button" disabled title="请先在「录制」步骤上传出镜视频">开始生成</button>
    <p className="field-hint">请先在「录制」步骤上传出镜视频，上传成功后会自动开始生成。</p>
  </div>;
  if (!vp) return <button type="button" className="primary-button" onClick={start}>开始生成</button>;

  // talking-head-broll 的重试/重新生成同理不能直接调用 start()——那会创建一条
  // 新记录但不会自动入队(入队只发生在 upload-source 成功之后), 必须回「录制」
  // 步骤重新上传一份视频才能再次触发生成。
  const canRestart = deliveryMode !== 'talking-head-broll';

  return <div className="video-production-panel">
    <div className="video-production-status"><strong>{STATUS_LABEL[vp.status] ?? vp.status}</strong></div>
    {vp.status === 'preview_ready' && vp.previewPath ? <>
      <video src={`/api/v1/cockpit/video-productions/${vp.id}/file?kind=preview`} controls className="video-production-preview" />
      <div className="video-production-actions">
        <button type="button" className="primary-button" onClick={approve}>确认导出</button>
        {canRestart ? <button type="button" className="secondary-button" onClick={start}>重新生成</button> : null}
      </div>
    </> : null}
    {vp.status === 'done' && vp.masterPath ? <a className="primary-button" href={`/api/v1/cockpit/video-productions/${vp.id}/file?kind=master`} download>下载成片</a> : null}
    {vp.status === 'failed' ? <>
      <p className="field-hint">{vp.errorMessage}</p>
      {canRestart ? <button type="button" className="secondary-button" onClick={start}>重试</button> : <p className="field-hint">请回「录制」步骤重新上传出镜视频以再次生成。</p>}
    </> : null}
  </div>;
}
