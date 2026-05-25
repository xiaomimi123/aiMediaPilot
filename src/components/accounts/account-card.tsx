import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Account = {
  id: string;
  platform: 'XIAOHONGSHU' | 'DOUYIN';
  platformLabel: string;
  nickname: string;
  avatar?: string | null;
  followerCount: number;
  followingCount: number;
  noteCount: number;
  likeCount: number;
  loginStatus: 'VALID' | 'EXPIRED' | 'NEVER_LOGGED';
  lastSyncAt?: string | null;
};

const PLATFORM_EMOJI: Record<Account['platform'], string> = { XIAOHONGSHU: '🔴', DOUYIN: '⚫' };

function timeAgo(iso?: string | null): string {
  if (!iso) return '从未同步';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function AccountCard({ account }: { account: Account }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-3">
          {account.avatar
            ? <img src={account.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
            : <div className="h-12 w-12 rounded-full bg-muted" />}
          <div className="flex-1">
            <div className="font-semibold">{PLATFORM_EMOJI[account.platform]} @{account.nickname}</div>
            <div className="text-xs text-muted-foreground">{account.platformLabel} · {timeAgo(account.lastSyncAt)}</div>
          </div>
          {account.loginStatus === 'EXPIRED' && <Badge variant="destructive">⚠ 重登</Badge>}
          {account.loginStatus === 'VALID' && <Badge variant="success">✓</Badge>}
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">粉丝</div><div className="font-semibold">{account.followerCount.toLocaleString()}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">关注</div><div className="font-semibold">{account.followingCount}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">笔记</div><div className="font-semibold">{account.noteCount}</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">获赞</div><div className="font-semibold">{account.likeCount.toLocaleString()}</div></div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled>同步 (Plan 2)</Button>
          <Button size="sm" variant="outline" disabled>重登 (Plan 2)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
