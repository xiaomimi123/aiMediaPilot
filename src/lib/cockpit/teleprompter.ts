export interface TeleprompterAct {
  act: string;
  title: string;
  /** 台词按句拆好 —— 提词器一行一句最好念 */
  lines: string[];
  narration: string;
  targetSec: number;
  /** 这一幕该从第几秒开始, 由前面各幕的 targetSec 累加 */
  startSec: number;
}

interface ActLike {
  act: string;
  title: string;
  narration: string;
  targetSec: number;
}

/** 中文口播的舒适语速区间(字/秒) —— 超出时页面提示"这一幕字太多/太少"。 */
export const COMFORTABLE_SPEED = { min: 4, max: 6 } as const;

/**
 * 六幕稿 → 提词器脚本(二十一期)。
 *
 * 动因: 用户用 iPhone 录口播时没有提词器, 只能一直看屏幕找词, 出不来流畅的表达。
 * 这个需求在十四期就记过("提词器仍待办"), 一直没做。
 *
 * 关键设计: 滚动速度按**每幕的目标秒数**推进, 而不是凭感觉给个固定速度 ——
 * 这样念完正好对上稿子设计的时长, 录出来不用再剪节奏。
 */
export function buildTeleprompterScript(acts: ActLike[]): TeleprompterAct[] {
  let cursor = 0;
  return acts.map((a) => {
    const row: TeleprompterAct = {
      act: a.act,
      title: a.title,
      narration: a.narration,
      targetSec: a.targetSec,
      startSec: cursor,
      lines: splitSentences(a.narration),
    };
    cursor += a.targetSec;
    return row;
  });
}

/** 按句号/问号/叹号/分号断句, 保留标点 —— 断句本身就是念稿的换气点。 */
function splitSentences(narration: string): string[] {
  const t = (narration ?? '').trim();
  if (!t) return [];
  return t
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 这一幕实际需要的语速(字/秒)。
 * 页面用它判断"这幕字数配不配得上目标秒数" —— 明显超出舒适区间时给提示,
 * 让用户在开录前就知道要么删字要么改时长, 而不是录到一半发现念不完。
 */
export function estimateActSpeed(narration: string, targetSec: number): number {
  const chars = (narration ?? '').replace(/\s/g, '').length;
  if (chars === 0) return 0;
  if (targetSec <= 0) return chars; // 不除零: 目标秒数缺失时按"一秒念完"给个有限值
  return chars / targetSec;
}
