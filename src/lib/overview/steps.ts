export const STEP_KEYS = ['topic', 'script', 'recording', 'film', 'publish', 'retro'] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const STEP_LABEL: Record<StepKey, string> = { topic: '选题', script: '脚本', recording: '口播', film: '成片', publish: '发布', retro: '复盘' };
export const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿', recorded: '已录制', final: '成片', published: '已发布' };

export interface StepInput {
  stage: string;
  hasBenchmark: boolean;
  hasScript: boolean;
  published: boolean;
  hasRetro: boolean;
}
export interface StepState {
  key: StepKey;
  label: string;
  done: boolean;
  current: boolean;
}

const ORDER = ['draft', 'scripted', 'recorded', 'final', 'published'];
const atLeast = (stage: string, min: string) => ORDER.indexOf(stage) >= ORDER.indexOf(min);

export function stepsOf(i: StepInput): StepState[] {
  const done: Record<StepKey, boolean> = {
    topic: i.hasBenchmark || i.hasScript,
    script: atLeast(i.stage, 'scripted'),
    recording: atLeast(i.stage, 'recorded'),
    film: atLeast(i.stage, 'final'),
    publish: i.published,
    retro: i.hasRetro,
  };
  const cur = STEP_KEYS.find((k) => !done[k]) ?? 'retro';
  return STEP_KEYS.map((key) => ({ key, label: STEP_LABEL[key], done: done[key], current: key === cur }));
}

export const currentStep = (i: StepInput): StepKey => stepsOf(i).find((s) => s.current)!.key;

const NEXT: Record<StepKey, string> = {
  topic: '下一步：定选题，和编导聊聊这条讲什么',
  script: '下一步：磨稿并定稿',
  recording: '下一步：录口播并上传',
  film: '下一步：在 Claude Code 里出片',
  publish: '下一步：发布并关联作品',
  retro: '下一步：等第 3 天复盘',
};
export const nextActionText = (key: StepKey) => NEXT[key];

export const STAGE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '写稿中' },
  { key: 'recording', label: '录制中' },
  { key: 'film', label: '成片' },
  { key: 'published', label: '已发布' },
] as const;

export interface WorkCardData {
  id: string;
  title: string;
  stage: string;
  steps: StepState[];
  durationSec: number | null;
  center: number | null;
  views: number | null;
  updatedAt: string;
}

export function filterOf(c: WorkCardData): string {
  if (c.steps.find((s) => s.key === 'publish')?.done) return 'published';
  if (c.stage === 'draft') return 'draft';
  if (c.stage === 'scripted') return 'recording';
  return 'film';
}
