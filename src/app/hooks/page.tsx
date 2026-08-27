import { PageShell } from '@/components/layout/page-shell';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export default function HooksPage() {
  return (
    <PageShell title="钩子库" description="前 3 秒决定完播。按实际留存排序，而不是按感觉。">
      <NotBuiltYet
        what="钩子库还没建"
        why="它会把你写过和拆过的开场钩子按模式归类，并按真实留存率排序。但排序需要「发布后回采」这一环的数据——当前发布 0 条，系统还不知道哪种钩子对你的账号真的有效。在那之前它只能给模型的猜测，那种排序不如不做。"
        waitingFor={{ text: '看数据链路断在哪', href: '/data' }}
      />
    </PageShell>
  );
}
