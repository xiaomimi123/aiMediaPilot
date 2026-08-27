import { PageShell } from '@/components/layout/page-shell';

/** 六幕稿工作区 —— 25/25 的实际使用都发生在这里。内容在阶段 4 实现。 */
export default async function WriteDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return (
    <PageShell title="六幕稿工作区" description={`稿子 ${id}`}>
      <p className="text-sm text-muted-foreground">阶段 4 实现三栏工作区。</p>
    </PageShell>
  );
}
