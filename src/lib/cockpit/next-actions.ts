import { CONTENT_STAGES, type ContentStage } from '@/lib/cockpit/model';

export interface NextAction {
  id: string;
  title: string;
  /** 下一步该做的事, 用动词 —— 用户要的是"我该干什么", 不是"这卡处于什么阶段" */
  action: string;
  platform: string;
  href: string;
}

interface ContentLike {
  id: string;
  title: string;
  stage: string;
  platform?: string;
  scriptDraftId?: string | null;
  publicationStatus?: string;
  updatedAt?: string;
}

/** 首页只列这么多 —— 再多就从"提示"变成"又一个看板", 反而没人看。 */
const MAX_ROWS = 8;

/** 不需要推进的终态。 */
const DONE_STAGES = new Set(['archived']);

function actionOf(c: ContentLike): string {
  switch (c.stage) {
    case 'inbox':
    case 'topic':
      return '定选题';
    case 'script':
      // 稿子已经写好却还停在 script 是常态(写稿接口不自动推进阶段) —— 这时候
      // 该提示去拍, 而不是让人对着一张"写稿中"的卡发愣不知道下一步干嘛
      return c.scriptDraftId ? '去拍摄' : '写稿';
    case 'recording':
      return '去拍摄';
    case 'editing':
      return '去剪辑';
    case 'publishing':
      return '去发布';
    case 'review':
      return '去复盘';
    default:
      return '继续推进';
  }
}

/**
 * 首页「今天要做的」(二十一期)。
 *
 * 动因: 用户反馈"不给链接就找不到入口"。平台里明明有内容卡, 但要先想清楚
 * "它在哪个平台的哪一列"才找得到; 首页原有的摘要条只说"你有 N 条待推进",
 * 报了数量却不说是哪几条、也点不进去。
 *
 * 这里直接把内容卡摆出来, 每条配一个**动词**和可点的链接, 让"我现在该干什么"
 * 一眼可答。刻意不做成又一个看板 —— 只留最靠近完成的几条。
 */
export function buildNextActions(contents: ContentLike[]): NextAction[] {
  const pending = contents.filter((c) => {
    if (DONE_STAGES.has(c.stage)) return false;
    // 已发布的不再需要推进(复盘阶段例外, 那是发布之后的活)
    if (c.publicationStatus === 'published' && c.stage !== 'review') return false;
    return true;
  });

  const stageRank = (s: string): number => {
    const i = CONTENT_STAGES.indexOf(s as ContentStage);
    return i < 0 ? -1 : i;
  };

  return pending
    .slice()
    .sort((a, b) => {
      // 越靠后的阶段排越前: 快完成的先收掉, 而不是让它一直挂在那儿
      const d = stageRank(b.stage) - stageRank(a.stage);
      if (d !== 0) return d;
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    })
    .slice(0, MAX_ROWS)
    .map((c) => ({
      id: c.id,
      title: c.title,
      action: actionOf(c),
      platform: c.platform ?? 'douyin',
      href: `/content/detail/${c.id}`,
    }));
}
