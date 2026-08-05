import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-mark"><UserPlus className="h-4 w-4" /></div>
      <h3>还没有绑定账号</h3>
      <p>点击下方按钮绑定你的第一个账号</p>
      <Link href="/accounts/bind"><Button>+ 绑定账号</Button></Link>
    </div>
  );
}
