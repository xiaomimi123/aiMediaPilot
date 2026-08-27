/**
 * 总览首页的数据聚合(v5 阶段 B)。
 *
 * 纯函数, 数据由调用方从库里取好传进来 —— 「漏斗断在哪一环」是能被测试钉住的
 * 判断, 不该埋在页面组件里。
 *
 * 一条硬规矩: **没有的数据如实报 0 并说明为什么, 不许补零凑好看。**
 * 账号指标 0 条、发布 0 条是这个产品当前的真实状态, 藏起来只会让人以为链路是通的。
 */

export interface PipelineCounts {
  radar: number;
  adopted: number;
  scripts: number;
  films: number;
  published: number;
}

export interface PipelineStage {
  key: keyof PipelineCounts;
  label: string;
  count: number;
  /** 相对上一环的转化率; 第一环为 null。 */
  conversion: number | null;
  /** 链路在这一环断了 —— 上一环有量, 这一环是 0, **且下游也全是 0**。 */
  broken: boolean;
  /** 这一环是 0 但下游有量 —— 说明它被绕过了, 不是堵住了。 */
  bypassed: boolean;
}

const STAGE_LABELS: Record<keyof PipelineCounts, string> = {
  radar: '雷达抓取',
  adopted: '采纳选题',
  scripts: '成稿',
  films: '出片',
  published: '发布',
};

const ORDER: (keyof PipelineCounts)[] = ['radar', 'adopted', 'scripts', 'films', 'published'];

/**
 * 内容管线漏斗。
 *
 * 「断点」= 上一环有量、这一环是 0、**且下游也全是 0**。最后那个条件很关键:
 * 真实数据里「采纳选题 0 而成稿 25」是常态 —— 稿子可以不经过选题池直接开,
 * 那一环是被**绕过**而不是**堵住**。少了这个条件, 漏斗会指着一个没问题的环
 * 让人去修, 而真正断的那一环反倒不显眼。
 *
 * 只报第一个断点 —— 后面每一环都是 0 是断点的后果而不是新问题。
 */
export function buildPipeline(counts: PipelineCounts): PipelineStage[] {
  let brokenFound = false;
  return ORDER.map((key, i) => {
    const count = counts[key];
    const prev = i === 0 ? null : counts[ORDER[i - 1]];
    const downstreamTotal = ORDER.slice(i + 1).reduce((n, k) => n + counts[k], 0);
    const empty = prev !== null && prev > 0 && count === 0;
    const broken = !brokenFound && empty && downstreamTotal === 0;
    if (broken) brokenFound = true;
    return {
      key,
      label: STAGE_LABELS[key],
      count,
      conversion: prev === null || prev === 0 ? null : count / prev,
      broken,
      bypassed: empty && downstreamTotal > 0,
    };
  });
}

export interface TodoItem {
  text: string;
  detail: string;
  href?: string;
  tone: 'block' | 'warn' | 'info';
}

/**
 * 今日待办。按「挡住整条链路的 → 影响单条内容的 → 提示性的」排序 ——
 * 一次只让人看见最该动手的那件。
 */
export function buildTodos(input: {
  workerOnline: boolean;
  queuedFilms: number;
  oldestQueuedDays: number | null;
  overtimeScripts: number;
  lowConfidenceFacts: number;
  radarBacklog: number;
}): TodoItem[] {
  const list: TodoItem[] = [];

  if (!input.workerOnline && input.queuedFilms > 0) {
    list.push({
      text: '启动出片 worker',
      detail:
        input.oldestQueuedDays !== null
          ? `${input.queuedFilms} 个任务积压，最早已等待 ${input.oldestQueuedDays} 天`
          : `${input.queuedFilms} 个任务在队列里等待`,
      href: '/films',
      tone: 'block',
    });
  }

  if (input.overtimeScripts > 0) {
    list.push({
      text: `${input.overtimeScripts} 份稿子有超时的幕`,
      detail: '某一幕的字数撑爆了它在结构里该占的时长',
      href: '/scripts',
      tone: 'warn',
    });
  }

  if (input.lowConfidenceFacts > 0) {
    list.push({
      text: `${input.lowConfidenceFacts} 条低置信事实待核`,
      detail: '开录前确认，说错了要掉粉',
      href: '/scripts',
      tone: 'warn',
    });
  }

  if (input.radarBacklog > 50) {
    list.push({
      text: `雷达堆积 ${input.radarBacklog} 条`,
      detail: '采集速度超过消化速度，建议减关键词或提高门槛',
      href: '/topics',
      tone: 'info',
    });
  }

  return list;
}
