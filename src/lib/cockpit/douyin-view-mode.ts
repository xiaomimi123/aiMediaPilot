import { isSixActScript } from '@/lib/script/six-act';

/**
 * `DouyinView`(script-result.tsx) 核心内容区渲染的四态判别 —— 从组件里抽出来的纯函数
 * (十三期任务五)。项目暂无组件渲染测试基建, 分岔逻辑本身可测、也最容易出 bug (漏字段/
 * 顺序错导致误判), 所以把判别拆成这个纯函数单测, 组件只管照着结果选 JSX 分支。
 *
 * 四态互斥, 按以下优先级依次判定 (与 DouyinView 原有 retentionBeats → sections 的判别
 * 顺序一致, 新插入的 six-act 态放在两者之间, 因为两种旧形状与 six-act 形状字段互斥,
 * 顺序对实际数据不影响结果, 但保持 legacy 优先级最高与原代码行为一致):
 *   1. legacy   — data.retentionBeats 是数组 (五期前的老形状)
 *   2. six-act  — data.script.acts + data.four_dims 通过 isSixActScript 校验 (十三期新形状)
 *   3. sections — data.script.sections 是数组 (五~十二期两阶段管线形状)
 *   4. empty    — 都不是 (对应组件里原先渲染 null 的情况)
 */
export type DouyinViewMode = 'legacy' | 'sections' | 'six-act' | 'empty';

interface LooseDouyinData {
  retentionBeats?: unknown;
  script?: {
    sections?: unknown;
    acts?: unknown;
  };
  four_dims?: unknown;
}

export function pickDouyinViewMode(data: unknown): DouyinViewMode {
  if (!data || typeof data !== 'object') return 'empty';
  const d = data as LooseDouyinData;

  if (Array.isArray(d.retentionBeats)) return 'legacy';
  if (isSixActScript({ acts: d.script?.acts, four_dims: d.four_dims })) return 'six-act';
  if (Array.isArray(d.script?.sections)) return 'sections';
  return 'empty';
}
