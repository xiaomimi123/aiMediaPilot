'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function StepLogin({
  sessionId, vncUrl, onLoggedIn, onCancel,
}: { sessionId: string; vncUrl: string; onLoggedIn: (accountId: string) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('STARTING');

  useEffect(() => {
    const es = new EventSource(`/api/v1/sessions/${sessionId}/events`);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.status) setStatus(data.status);
      if (data.status === 'LOGGED_IN' && data.accountId) onLoggedIn(data.accountId);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [sessionId, onLoggedIn]);

  const handleCancel = async () => {
    await fetch(`/api/v1/sessions/${sessionId}/cancel`, { method: 'POST' });
    onCancel();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">在嵌入浏览器里登录</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            手机小红书 App → 我 → 右上扫码图标 → 扫下方二维码 → 手机确认
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
            ⏳ {status === 'STARTING' ? '启动中...' : status === 'WAITING_LOGIN' ? '等待扫码...' : status}
          </span>
          <Button variant="outline" size="sm" onClick={handleCancel}>取消</Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        {/* iframe 占满宽 + 用容器比例 (1280:800 = 16:10) 保证容器内 Chromium 1:1 显示,二维码不再被压缩 */}
        <div className="relative w-full" style={{ aspectRatio: '1280 / 800' }}>
          <iframe
            src={vncUrl}
            className="absolute inset-0 h-full w-full border-0"
            title="noVNC"
            allow="fullscreen; clipboard-read; clipboard-write"
          />
        </div>
      </Card>
    </div>
  );
}
