import { PageShell } from '@/components/layout/page-shell';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export default function MaterialsPage() {
  return (
    <PageShell title="素材库" description="读到、想到、经历过的具体材料。写稿时按幕检索。">
      <NotBuiltYet
        what="素材库还没建"
        why="它要存书摘、数据、故事、金句和亲身经历五类材料，写稿时按当前幕自动检索。没有它的时候，AI 写到需要具体材料的地方就会开始编——这是六幕稿目前最大的失真来源。其中「亲身经历」只有你自己能录，书摘和数据 AI 也查得到，所以那一类才是账号差异化的唯一来源。"
      />
    </PageShell>
  );
}
