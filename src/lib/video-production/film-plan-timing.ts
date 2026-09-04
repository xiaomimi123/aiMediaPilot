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
 *   也没台词(见 `shot-clamp.ts` 的 `clampShotsToSource` 注释)。
 * - **不从 0 起**: 片头一段黑屏。
 *
 * 返回的字符串会被**原样喂回给模型**, 所以措辞是契约的一部分: 每条只讲一个问题、
 * 只讲时间、给出具体数字, 不提卡片类型(提了模型会跑去改卡片而不是改时间)。
 */
/**
 * 铺满校验的公共内核——检查一批镜头在 `[startMs, endMs)` 这段区间内是否
 * 首尾相接、无缝覆盖。`checkFilmPlanTiming`(整片铺满)与
 * `checkFilmPlanTimingWindowed`(窗口版, 见下方)共用这份逻辑, 差异只在
 * "要铺满的是哪一段区间"——前者是全片(0 到 totalMs), 后者是每一幕自己的
 * 时间窗。抽出来是二十九期 Task 6 返工时做的, 抽取前后对 `checkFilmPlanTiming`
 * 的输出**逐字节不变**(`startMs` 原来硬编码的字面量 `0` 换成了同值的参数,
 * 拼出来的文案完全一致), 现有测试不用动。
 */
function checkCoverage(shots: FilmPlan['shots'], startMs: number, endMs: number, emptyMessage: string): string[] {
  const sorted = [...shots].sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [emptyMessage];

  const issues: string[] = [];

  if (sorted[0].startMs > startMs + TOLERANCE_MS) {
    issues.push(`第一镜从 ${sorted[0].startMs} 毫秒才开始, 片头会有一段黑屏。第一镜必须从 ${startMs} 开始。`);
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].startMs - sorted[i - 1].endMs;
    if (gap > TOLERANCE_MS) {
      issues.push(
        `${sorted[i - 1].endMs} 毫秒到 ${sorted[i].startMs} 毫秒之间有 ${gap} 毫秒没有任何画面(黑屏)。` +
          `把前一镜的 endMs 延到 ${sorted[i].startMs}, 或者把后一镜的 startMs 提到 ${sorted[i - 1].endMs}。`,
      );
    }
  }

  const lastMs = sorted[sorted.length - 1].endMs;
  if (lastMs > endMs + TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒, 但内容只有 ${endMs} 毫秒。超出的部分是没有台词的画面, 把最后一镜的 endMs 改成 ${endMs}。`,
    );
  }
  if (lastMs < endMs - TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒就结束了, 但内容有 ${endMs} 毫秒, 结尾会有一段黑屏。把最后一镜的 endMs 改成 ${endMs}。`,
    );
  }

  return issues;
}

export function checkFilmPlanTiming(plan: FilmPlan, totalMs: number): string[] {
  return checkCoverage(plan.shots, 0, totalMs, '分镜是空的, 至少要有一镜。');
}

/**
 * `checkFilmPlanTiming` 的窗口版 —— pip 出镜链专属(二十九期 Task 6 用户验收返工)。
 *
 * 背景: pip 版式("人物小窗常驻 + PPT 卡片当主画面")用的是主链提示词
 * `FILM_PLAN`("幕内首尾相接铺满、不留空档"), 因为真人已经缩进小窗、主画面的
 * 空档不再是"露出真人"而是"空背景", 语义上等同 `checkFilmPlanTiming` 要拦的
 * 黑屏。但出镜链的时间窗来自真实语音对齐(`actWindowsFromAligned`) ——
 * **没讲到的幕不产生窗口**(该函数顶部注释), 幕与幕之间可能天然留有空隙;
 * 这段空隙不是缺陷(pip 下真人小窗全程可见, 空隙时段观众看到的是"人物讲话、
 * 无卡片", 这正是本次返工要的常驻浮层效果), 不该被当成黑屏喂回模型。
 *
 * 裁决(见 progress.md Ruling-4): 不是简单地把 `checkFilmPlanTiming` 的
 * `totalMs` 换成"首窗 start 到末窗 end"这一个数——那样只能修好首尾两处,
 * 修不好**中间**两个不相邻窗口之间的天然间隙(模型改不出一个"跨越无声区间"
 * 的镜头, 那种间隙仍会被当黑屏报错)。这里改成按窗口分组校验: 每一幕的时间
 * 窗各自套用 `checkCoverage`(幕内必须铺满, 一镜都没有也算问题——`FILM_PLAN`
 * 的系统提示词本就要求"把每一幕拆成 1~4 镜, 不要一幕只给一镜"), 幕与幕之间
 * 的间隙从一开始就不在任何一个窗口的检查范围内, 天然被放过, 不需要额外的
 * "允许间隙"白名单逻辑。落在两个窗口之间的多余镜头(如果模型自己加了)既不
 * 违反任何一个窗口的铺满要求, 也不会被这里报错——"允许 shots 与窗口对齐"。
 *
 * 签名与 `checkFilmPlanTiming` 不同(多一个 `windows` 参数、没有 `totalMs`),
 * 所以是独立的导出函数, 不是重载——调用点(worker)按 layout 选一个来用。
 */
export function checkFilmPlanTimingWindowed(
  plan: FilmPlan,
  windows: { startMs: number; endMs: number }[],
): string[] {
  // 零时长窗口(没讲到的幕)不算"有效窗口", 见下方循环体内的过滤注释——
  // 这里提前判断一次是为了在"一幕都没讲到"这种全零长度的极端情况下给出
  // 明确提示, 而不是静默返回空数组让人以为"全部通过"。
  if (windows.every((w) => w.endMs <= w.startMs)) {
    return ['一个有效的幕时间窗都没有, 至少要有一幕讲到内容。'];
  }

  const issues: string[] = [];
  for (const w of windows) {
    /*
     * 零时长幕跳过, 不当成"没覆盖"报错——`actWindowsFromAligned` 对完全没
     * 讲到的幕产出的就是 `startMs === endMs` 这种零长度窗口(该函数顶部注释:
     * "没有覆盖到的幕不产生窗口"里"不产生"的实际实现是"产生一个零长度的",
     * 不是从数组里整条去掉)。零长度窗口天然无法覆盖(区间长度为 0), 不跳过
     * 的话真机第一次跑就会对着六幕脚本里没讲到的每一幕各报一条假警告
     * (2026-09-04 复现: 6 幕稿只讲了 1 幕, 另外 5 幕全部误报)。
     */
    if (w.endMs <= w.startMs) continue;
    // 按"起点落在这一幕窗口内"分组——与 `FILM_PLAN` 提示词对模型的要求
    // ("每一镜的 startMs/endMs 必须落在它所属那一幕的时间窗之内")一致,
    // 不做起点、终点分别归属的复杂判断。
    const shotsInWindow = plan.shots.filter((s) => s.startMs >= w.startMs && s.startMs < w.endMs);
    issues.push(
      ...checkCoverage(
        shotsInWindow,
        w.startMs,
        w.endMs,
        `${w.startMs} 毫秒到 ${w.endMs} 毫秒这一幕没有任何镜头覆盖, 观众会看到空背景。`,
      ),
    );
  }
  return issues;
}

/**
 * 出镜链版最短镜长(与 `film-plan-prompt.ts` 的 `FILM_PLAN_BROLL` 提示词文案里的数字一致)。
 *
 * 与 `shot-clamp.ts` 的 `MIN_SHOT_MS`(=1000, `clampShotsToSource` 渲染前
 * 裁剪用)不是同一件事、数值也故意不同, 别当成对不上的 bug 误改成一致:
 * - 这里(`BROLL_MIN_SHOT_MS`=1200)是 FilmPlan 修复循环里"引导模型别排太短的镜"
 *   的**软标准**, 在渲染之前、素材还没被 `clampShotsToSource` 裁过。
 * - `shot-clamp.ts` 的 `MIN_SHOT_MS`(=1000)是裁剪**之后**"短于此就整镜丢弃"
 *   的**硬下限**。
 *
 * 前者故意比后者严(1200 > 1000): FilmPlan 产出的镜头到了 `clampShotsToSource`
 * 那一步, `endMs` 可能因为超出源视频时长被夹小(见该函数注释里 155 秒素材的
 * 真实事故), 一镜从 1200ms 被夹到比如 1050ms 完全正常——如果两个阈值相等,
 * 这种"因裁剪而缩短、但仍然可用"的镜头会在裁剪那一步被硬下限误杀, 而
 * `checkBrollPlanTiming` 这一关根本看不到裁剪后的结果、拦不住。留出的这
 * 200ms 缓冲就是防这个的, 不是随手取的两个数。
 */
const BROLL_MIN_SHOT_MS = 1200;

/**
 * 镜间最小间隔——复审补(二十九期 Task 4 复审): "不查空档"的裁决只对**大空档**
 * 成立(空档=露出出镜画面, 是设计好的功能), 但**极短空档**是另一种缺陷: 两镜
 * 间隙只有几十~几百毫秒时, 成片里是真人画面一闪而过, 观感是镜头故障(jump
 * cut), 不是"正常露出真人讲话"。
 *
 * 阈值定 1000ms: 低于 1 秒的真人露出, 观众读不出"回到主讲人"这层意思, 只剩
 * 闪烁感——与 `BROLL_MIN_SHOT_MS`(镜头本身至少多长)是同一数量级的"最短可读
 * 时长"判断, 只是这次判断的对象是镜头之间的间隙而不是镜头本身。
 */
const BROLL_MIN_GAP_MS = 1000;

/**
 * `FilmPlanSchema` 拦不住的时间轴问题 —— 出镜链专属版本(二十九期 Task 4)。
 *
 * 与 `checkFilmPlanTiming` 的关键差异: **不查大空档**。出镜链画面全程有真人
 * 出镜视频铺底, 卡片窗口之外观众看到的是本人讲话, 空档是这条链的正常功能,
 * 不是缺陷——铺满校验的"空档=黑屏"前提在这里不成立(见 `FILM_PLAN_BROLL`
 * 顶部注释)。也不查"第一镜必须从 0 开始"——出镜链完全可能从头到尾都没有卡片。
 *
 * 仍然要查的三类, `FilmPlanSchema` 管不到、又真的会毁掉成片:
 * - **超出源视频时长**: 旧链真出过事故(见 `shot-clamp.ts` 的
 *   `clampShotsToSource` 注释), 这里的 `totalMs` 必须传源视频真实时长
 *   (ffprobe 出的毫秒数), 不是幕窗口总和。
 * - **单镜过短**: 观众读不完。
 * - **镜间间隙过短(复审补)**: "不查空档"只对**大**空档成立, 但间隙落在
 *   `(0, BROLL_MIN_GAP_MS)` 这个区间时是另一种缺陷——真人画面一闪而过,
 *   是 jump cut 故障感, 不是"正常露出真人讲话"。间隙恰好为 0(两镜紧邻)或
 *   `>= BROLL_MIN_GAP_MS`(露脸时间够长, 读得出"回到主讲人")都不报。
 *
 * 返回的字符串会被原样喂回给模型, 措辞与 `checkFilmPlanTiming` 同一惯例:
 * 每条只讲一个问题、只讲时间、给出具体数字。
 */
export function checkBrollPlanTiming(plan: FilmPlan, totalMs: number): string[] {
  const shots = [...plan.shots].sort((a, b) => a.startMs - b.startMs);
  const issues: string[] = [];

  for (const shot of shots) {
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

  for (let i = 1; i < shots.length; i += 1) {
    const gap = shots[i].startMs - shots[i - 1].endMs;
    if (gap > 0 && gap < BROLL_MIN_GAP_MS) {
      issues.push(
        `镜头 ${shots[i - 1].shotId}(到 ${shots[i - 1].endMs} 毫秒)到镜头 ${shots[i].shotId}` +
          `(从 ${shots[i].startMs} 毫秒开始)之间只闪现 ${gap} 毫秒的真人画面, 太短了会像镜头故障。` +
          `间隙要么为 0(紧邻), 要么至少 ${BROLL_MIN_GAP_MS} 毫秒——把镜头 ${shots[i - 1].shotId} 的` +
          ` endMs 延到 ${shots[i].startMs}, 或者把镜头 ${shots[i].shotId} 的 startMs 提前到` +
          ` ${shots[i - 1].endMs}, 或者干脆合并这两镜。`,
      );
    }
  }

  return issues;
}
