import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';

const NICHE_LABEL_MAP = new Map(KNOWN_NICHES.map((n) => [n.key, n.label]));

export default async function ScriptListPage() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, topic: true, niche: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">我的脚本</h1>
          <p className="mt-1 text-sm text-muted-foreground">保存的 AI 生成脚本,可直接开新分析。</p>
        </div>
        <Link href="/content/script/new">
          <Button variant="brand">✏️ 写新脚本 →</Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-sm text-muted-foreground">你还没保存过脚本。</p>
            <Link href="/content/script/new">
              <Button size="sm" variant="outline">
                写第一个 →
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">主题</th>
                  <th className="py-2 text-left">垂类</th>
                  <th className="py-2 text-right">时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-2">
                      <Link href={`/content/script/${it.id}`} className="hover:text-primary">
                        {it.topic}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {NICHE_LABEL_MAP.get(it.niche) ?? it.niche}
                    </td>
                    <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                      {new Date(it.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
