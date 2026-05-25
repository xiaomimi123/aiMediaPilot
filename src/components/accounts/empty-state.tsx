import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4"><UserPlus className="h-8 w-8 text-muted-foreground" /></div>
      <h3 className="mt-4 text-lg font-semibold">还没有绑定账号</h3>
      <p className="mt-1 text-sm text-muted-foreground">点击下方按钮绑定你的第一个账号</p>
      <Link href="/accounts/bind" className="mt-4"><Button>+ 绑定账号</Button></Link>
    </div>
  );
}
