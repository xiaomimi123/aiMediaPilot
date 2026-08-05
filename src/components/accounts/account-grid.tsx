'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AccountCard } from './account-card';
import { EmptyState } from './empty-state';

export function AccountGrid() {
  const [accounts, setAccounts] = useState<any[] | null>(null);

  useEffect(() => {
    fetch('/api/v1/accounts').then((r) => r.json()).then((j) => {
      if (j.success) setAccounts(j.data);
    });
  }, []);

  if (accounts === null) return <p className="text-sm text-[var(--muted)]">加载中...</p>;
  if (accounts.length === 0) return <EmptyState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">账号管理</h1>
        <Link href="/accounts/bind"><Button>+ 绑定账号</Button></Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => <AccountCard key={a.id} account={a} />)}
      </div>
    </div>
  );
}
