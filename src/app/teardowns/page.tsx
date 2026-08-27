import { PageShell } from '@/components/layout/page-shell';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export default function TeardownsPage() {
  return (
    <PageShell title="拆解" description="上传对标视频，拆出结构、钩子和文案节奏，可直接转成选题。">
      <NotBuiltYet
        what="拆解还没接进来"
        why="你现在是手工做这件事的（Obsidian 里那两份「奥一」和「王飞雨」的拆解就是）。当前评分体系的维度正是从那两份里提炼的，所以这个板块不是锦上添花——它是评分标准的来源。接进来之后，拆解结果可以直接变成选题，也可以补进钩子库。"
      />
    </PageShell>
  );
}
