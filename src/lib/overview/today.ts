import { nextActionText, type StepState, type WorkCardData } from './steps';

export interface TodoItem {
  kind: 'task' | 'link' | 'lesson' | 'note' | 'lag' | 'formula';
  text: string;
  href: string;
}
export interface InProgressItem {
  id: string;
  title: string;
  steps: StepState[];
  next: string;
  center: number | null;
  first: boolean;
}

export function buildToday(i: {
  failingTasks: { hint: string }[];
  pendingLinks: { projectId: string; title: string }[];
  lessonCandidates: number;
  pendingNotes: { projectId: string; title: string }[];
  lagging: { projectId: string; title: string }[];
  formulaProposed: boolean;
  works: WorkCardData[];
}): { todos: TodoItem[]; inProgress: InProgressItem[]; empty: boolean } {
  const todos: TodoItem[] = [
    ...i.failingTasks.map((t): TodoItem => ({ kind: 'task', text: t.hint, href: '/settings#tasks' })),
    ...i.pendingLinks.map((p): TodoItem => ({ kind: 'link', text: `「${p.title}」有一条作品等你确认`, href: `/projects/${p.projectId}` })),
    ...(i.lessonCandidates ? [{ kind: 'lesson' as const, text: `${i.lessonCandidates} 条写法经验等你决定`, href: '/settings#lessons' }] : []),
    ...i.pendingNotes.map((p): TodoItem => ({ kind: 'note', text: `「${p.title}」要不要存进 Obsidian`, href: `/projects/${p.projectId}` })),
    ...i.lagging.map((p): TodoItem => ({ kind: 'lag', text: `「${p.title}」比预期落后`, href: `/projects/${p.projectId}` })),
    ...(i.formulaProposed ? [{ kind: 'formula' as const, text: '预测公式有一条调整建议', href: '/settings#formula' }] : []),
  ];
  const active = i.works
    .filter((w) => !w.steps.find((s) => s.key === 'publish')!.done)
    .sort((a, b) => (b.center ?? -1) - (a.center ?? -1));
  const predicted = active.filter((w) => w.center !== null).length;
  const inProgress = active.map((w, idx): InProgressItem => {
    const cur = w.steps.find((s) => s.current)!;
    return { id: w.id, title: w.title, steps: w.steps, next: nextActionText(cur.key), center: w.center, first: idx === 0 && predicted >= 2 && w.center !== null };
  });
  return { todos, inProgress, empty: todos.length === 0 && inProgress.length === 0 };
}
