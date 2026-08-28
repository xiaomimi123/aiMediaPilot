/**
 * 出片流程的阶段视图(二十三期)。
 *
 * 为什么需要它: 这条链路九条任务全部停在 `preview_ready` 半个多月, 因为
 * **唯一能「确认导出」的界面在 v5 重建里跟 `/content` 页一起被删了**, 而
 * approve 接口和 worker 的 master→packaging→done 分支都还在。界面上只显示一个
 * 状态英文单词的时候, 没人看得出「预览就绪」是在等人点一下, 而不是在跑。
 *
 * 所以这里把状态翻译成两件事: **现在到哪一步了**, 以及**下一步等谁**。
 * 「等你」和「在跑」必须分开 —— 混在一起就是上面那半个月。
 */

export const PRODUCTION_STAGES = [
  { key: 'queued', label: '排队' },
  { key: 'directing', label: '构思分镜' },
  { key: 'building', label: '搭建画面' },
  { key: 'assembling', label: '拼接预览' },
  { key: 'preview_ready', label: '预览就绪' },
  { key: 'rendering', label: '正式渲染' },
  { key: 'packaging', label: '包装' },
  { key: 'done', label: '完成' },
] as const;

export type StageKey = (typeof PRODUCTION_STAGES)[number]['key'];

/** 状态 → 它落在哪一阶段。source_uploaded 归排队, approved 归正式渲染。 */
const STATUS_TO_STAGE: Record<string, StageKey> = {
  queued: 'queued',
  source_uploaded: 'queued',
  directing: 'directing',
  building: 'building',
  assembling: 'assembling',
  preview_ready: 'preview_ready',
  approved: 'rendering',
  rendering: 'rendering',
  packaging: 'packaging',
  done: 'done',
};

export function stageIndex(status: string): number {
  const stage = STATUS_TO_STAGE[status];
  if (!stage) return -1; // failed 或未知状态: 不落在任何阶段上
  return PRODUCTION_STAGES.findIndex((s) => s.key === stage);
}

export type WaitingOn = 'you' | 'machine' | 'nobody';

/**
 * 下一步等谁。
 *
 * - `you`     —— 等你点一下(预览就绪等确认导出、失败等重新制作、没开工等开始制作)
 * - `machine` —— 在跑, 等就行
 * - `nobody`  —— 完成了
 */
export function waitingOn(status: string): WaitingOn {
  if (status === 'done') return 'nobody';
  if (status === 'preview_ready' || status === 'failed') return 'you';
  if (status === 'queued' || status === 'source_uploaded') return 'you';
  return 'machine';
}

/** 这条任务还在跑吗 —— 决定页面要不要轮询。 */
export function isInFlight(status: string): boolean {
  return waitingOn(status) === 'machine';
}

/** 一句话说明现在的处境。空态和进度条都靠它, 避免两处各写一套说法。 */
export function stageHint(status: string): string {
  switch (status) {
    case 'queued':
    case 'source_uploaded':
      return '还没开工。点「开始制作」把它推进队列。';
    case 'directing':
      return 'AI 正在构思分镜。';
    case 'building':
      return 'AI 正在搭建画面。这一步最慢。';
    case 'assembling':
      return '正在拼接预览片。';
    case 'preview_ready':
      return '预览好了，等你看过之后确认导出——在那之前它会一直停在这儿。';
    case 'approved':
      return '已确认，正式渲染排队中。';
    case 'rendering':
      return '正在渲染正式成片。';
    case 'packaging':
      return '正在按模板加字幕、BGM 和片头片尾。';
    case 'done':
      return '成片好了，可以下载。';
    case 'failed':
      return '这条失败了。看下面的报错，修掉之后可以重新制作。';
    default:
      return '';
  }
}
