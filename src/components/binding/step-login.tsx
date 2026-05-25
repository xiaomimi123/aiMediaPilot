'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
      <h2 className="text-xl font-semibold">在嵌入浏览器里登录</h2>
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 overflow-hidden">
          <iframe src={vncUrl} className="h-[500px] w-full border-0" title="noVNC" />
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h3 className="font-semibold">操作指引</h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>打开手机小红书 App</li>
              <li>"我" → 右上扫码图标</li>
              <li>扫左边的二维码</li>
              <li>手机上确认登录</li>
            </ol>
            <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⏳ 等待登录中... <br/>当前状态: <code>{status}</code>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancel}>取消</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
