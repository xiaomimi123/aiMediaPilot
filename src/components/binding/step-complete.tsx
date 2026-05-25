'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function StepComplete({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ nickname: string; followerCount: number; noteCount: number; cachedNoteCount: number } | null>(null);

  useEffect(() => {
    fetch('/api/v1/accounts')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          const a = j.data.find((x: any) => x.id === accountId);
          if (a) setData(a);
        }
      });
  }, [accountId]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">✓ 绑定完成</h2>
      <Card>
        <CardContent className="space-y-3 pt-6">
          {data ? (
            <>
              <div className="text-lg font-semibold">@{data.nickname}</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md bg-muted p-3 text-sm">粉丝 <b>{data.followerCount.toLocaleString()}</b></div>
                <div className="rounded-md bg-muted p-3 text-sm">主页笔记数 <b>{data.noteCount}</b></div>
                <div className="rounded-md bg-muted p-3 text-sm">已抓取 <b>{data.cachedNoteCount}</b></div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">加载账号信息...</p>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => router.push('/accounts')}>完成,去看数据 →</Button>
      </div>
    </div>
  );
}
