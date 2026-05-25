'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function StepLogin({
  sessionId, onLoggedIn, onCancel,
}: { sessionId: string; onLoggedIn: (accountId: string) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('STARTING');
  const [qrCode, setQrCode] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/v1/sessions/${sessionId}/events`);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.status) setStatus(data.status);
      if (data.qrCode) setQrCode(data.qrCode);
      if (data.status === 'LOGGED_IN' && data.accountId) onLoggedIn(data.accountId);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [sessionId, onLoggedIn]);

  const handleCancel = async () => {
    await fetch(`/api/v1/sessions/${sessionId}/cancel`, { method: 'POST' });
    onCancel();
  };

  const statusLabel: Record<string, string> = {
    STARTING: '正在启动浏览器...',
    WAITING_LOGIN: '等待扫码,二维码 3 分钟有效',
    SCRAPING: '已登录,正在抓取主页...',
    EXPIRED: '会话超时',
    ERROR: '出错了',
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">手机扫码登录</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          手机小红书 App → 我 → 右上扫码图标 → 扫下方二维码 → 手机确认
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          {qrCode ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt="登录二维码"
                className="h-64 w-64 rounded-lg border bg-white p-3"
              />
              <div className="text-sm text-muted-foreground">
                {statusLabel[status] ?? status}
              </div>
            </>
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
              {statusLabel[status] ?? status}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={handleCancel}>取消</Button>
      </div>
    </div>
  );
}
