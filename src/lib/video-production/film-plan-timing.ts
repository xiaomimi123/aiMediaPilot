import type { FilmPlan } from '@/lib/video-production/shot-plan';

/**
 * 取整容差: 30fps 下一帧约 33 毫秒。
 * 比一帧还小的缝隙在成片里根本不存在, 拿它去逼模型重跑一轮纯属浪费。
 */
const TOLERANCE_MS = 33;

/**
 * `FilmPlanSchema` 拦不住的时间轴问题(二十七期)。
 *
 * schema 已经拦掉"重叠"与"endMs <= startMs"。剩下三类它管不着, 但每一类都会直接
 * 毁掉成片:
 * - **空档**: 两镜之间有缝, 观众看到的就是黑屏。
 * - **超出片长**: 旧链真出过 —— 素材 155 秒、分镜排到 234 秒, 尾巴上 79 秒既没人声
 *   也没台词(见 `director-prompt.ts` 的 `clampShotsToSource` 注释)。
 * - **不从 0 起**: 片头一段黑屏。
 *
 * 返回的字符串会被**原样喂回给模型**, 所以措辞是契约的一部分: 每条只讲一个问题、
 * 只讲时间、给出具体数字, 不提卡片类型(提了模型会跑去改卡片而不是改时间)。
 */
export function checkFilmPlanTiming(plan: FilmPlan, totalMs: number): string[] {
  const shots = [...plan.shots].sort((a, b) => a.startMs - b.startMs);
  if (shots.length === 0) return ['分镜是空的, 至少要有一镜。'];

  const issues: string[] = [];

  if (shots[0].startMs > TOLERANCE_MS) {
    issues.push(`第一镜从 ${shots[0].startMs} 毫秒才开始, 片头会有一段黑屏。第一镜必须从 0 开始。`);
  }

  for (let i = 1; i < shots.length; i += 1) {
    const gap = shots[i].startMs - shots[i - 1].endMs;
    if (gap > TOLERANCE_MS) {
      issues.push(
        `${shots[i - 1].endMs} 毫秒到 ${shots[i].startMs} 毫秒之间有 ${gap} 毫秒没有任何画面(黑屏)。` +
          `把前一镜的 endMs 延到 ${shots[i].startMs}, 或者把后一镜的 startMs 提到 ${shots[i - 1].endMs}。`,
      );
    }
  }

  const lastMs = shots[shots.length - 1].endMs;
  if (lastMs > totalMs + TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒, 但内容只有 ${totalMs} 毫秒。超出的部分是没有台词的画面, 把最后一镜的 endMs 改成 ${totalMs}。`,
    );
  }
  if (lastMs < totalMs - TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒就结束了, 但内容有 ${totalMs} 毫秒, 结尾会有一段黑屏。把最后一镜的 endMs 改成 ${totalMs}。`,
    );
  }

  return issues;
}

/** 出镜链版最短镜长(与 `film-plan-prompt.ts` 的 `FILM_PLAN_BROLL` 提示词文案里的数字一致)。 */
const BROLL_MIN_SHOT_MS = 1200;

/**
 * `FilmPlanSchema` 拦不住的时间轴问题 —— 出镜链专属版本(二十九期 Task 4)。
 *
 * 与 `checkFilmPlanTiming` 的关键差异: **不查空档**。出镜链画面全程有真人出镜
 * 视频铺底, 卡片窗口之外观众看到的是本人讲话, 空档是这条链的正常功能, 不是
 * 缺陷——铺满校验的"空档=黑屏"前提在这里不成立(见 `FILM_PLAN_BROLL` 顶部注释)。
 * 也不查"第一镜必须从 0 开始"——出镜链完全可能从头到尾都没有卡片。
 *
 * 仍然要查的两类, `FilmPlanSchema` 管不到、又真的会毁掉成片:
 * - **超出源视频时长**: 旧链真出过事故(见 `director-prompt.ts` 的
 *   `clampShotsToSource` 注释), 这里的 `totalMs` 必须传源视频真实时长
 *   (ffprobe 出的毫秒数), 不是幕窗口总和。
 * - **单镜过短**: 观众读不完。
 *
 * 返回的字符串会被原样喂回给模型, 措辞与 `checkFilmPlanTiming` 同一惯例:
 * 每条只讲一个问题、只讲时间、给出具体数字。
 */
export function checkBrollPlanTiming(plan: FilmPlan, totalMs: number): string[] {
  const issues: string[] = [];
  for (const shot of plan.shots) {
    if (shot.endMs > totalMs + TOLERANCE_MS) {
      issues.push(
        `镜头 ${shot.shotId} 到 ${shot.endMs} 毫秒结束, 但出镜素材只有 ${totalMs} 毫秒, 超出了素材时长。把 endMs 改成不超过 ${totalMs}。`,
      );
    }
    const durationMs = shot.endMs - shot.startMs;
    if (durationMs < BROLL_MIN_SHOT_MS) {
      issues.push(
        `镜头 ${shot.shotId} 只有 ${durationMs} 毫秒, 短于 ${BROLL_MIN_SHOT_MS} 毫秒的下限, 观众读不完。删掉这一镜, 或者把它延长到至少 ${BROLL_MIN_SHOT_MS} 毫秒。`,
      );
    }
  }
  return issues;
}
