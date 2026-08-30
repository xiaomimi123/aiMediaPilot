/**
 * 静止段检测(二十三期)。
 *
 * **补的是我们体检里缺的一整维: 时间。**
 *
 * 我做的四道画面关(空屏 / 空壳色块 / 版面 / 文字被裁)全部是**逐帧**判的 —— 每镜取
 * 六个点, 每个点看一张图。这套东西对「这一帧长什么样」很有效, 但对「这一段有没有
 * 在动」完全没有感知: 一个镜头可以每一帧都合格, 而整整三秒纹丝不动。观众看到的是
 * 一段视频, 不是六张图。
 *
 * 做法学自 video-talkcraft 那份 skill 的 `motion_check.py`, 它的验收原则写得很准:
 * 「任何 1 秒取样都不该出现完全静止的画面窗口 —— 相机漂移 / idle 呼吸 / 环境层
 * 必须让每一个静息帧都活着」。这个项目现在没有相机层和环境层, 所以门槛放松成
 * 「不要长时间死画面」, 但那一维必须先量得出来, 才谈得上后面做不做运镜。
 *
 * 用 ffmpeg 自带的 `freezedetect`, 不自己逐帧比对: 它在解码层做, 一次扫完整片,
 * 比我们抽帧再比像素快一个量级, 而且是成熟实现。
 */

export interface FreezeOpts {
  /** 连续静止多久才算一段。 */
  minSec: number;
  /** 判定「没变化」的噪声容差(0~1)。 */
  noise: number;
}

export const DEFAULT_FREEZE_OPTS: FreezeOpts = { minSec: 0.8, noise: 0.003 };

/**
 * `-an` 丢掉音轨、输出到 null: 我们只要 stderr 上的检测日志, 不需要任何产物。
 */
export function buildFreezeDetectArgs(videoPath: string, opts: FreezeOpts = DEFAULT_FREEZE_OPTS): string[] {
  return [
    '-hide_banner',
    '-i', videoPath,
    '-vf', `freezedetect=n=${opts.noise}:d=${opts.minSec}`,
    '-an',
    '-f', 'null',
    '-',
  ];
}

export interface FreezeSegment {
  startSec: number;
  durationSec: number;
}

/**
 * 从 ffmpeg 的 stderr 里解出静止段。
 *
 * freezedetect 输出三行一组(start / duration / end), 但**静止一直持续到片尾时只有
 * start, 没有 duration** —— 真机踩过: 造一条后 10 秒纯色的样本, ffmpeg 打了
 * `freeze_start: 5` 就没了下文, 而我按「必须有 duration」过滤, 于是解出 0 段,
 * 一条 67% 都是死画面的片子判成「通过」。
 *
 * 给了 `totalSec` 就把末段补齐到片尾; 不给则只能丢掉那一段(并在此说明代价)。
 */
export function parseFreezeOutput(stderr: string, totalSec?: number): FreezeSegment[] {
  const starts: number[] = [];
  const durations: number[] = [];
  for (const line of stderr.split('\n')) {
    const s = line.match(/freeze_start:\s*([\d.]+)/);
    if (s) starts.push(Number(s[1]));
    const d = line.match(/freeze_duration:\s*([\d.]+)/);
    if (d) durations.push(Number(d[1]));
  }
  return starts
    .map((startSec, i) => ({
      startSec,
      // 末段没有 duration 就补到片尾 —— 那正是「一直静止到结束」这种最坏的情况
      durationSec: durations[i] ?? (totalSec !== undefined ? Math.max(0, totalSec - startSec) : 0),
    }))
    .filter((x) => x.durationSec > 0);
}

/** 静止总时长占全片超过这个比例才算问题。 */
const MAX_FREEZE_RATIO = 0.08;

/**
 * 跑一次检测, 返回 ffmpeg 的诊断输出。
 *
 * **必须显式收 stderr, 且不能只在失败时收。** 踩过: 用 execFileSync 只在抛异常时
 * 从 error.stderr 里取, 而 freezedetect 正常退出 —— 于是拿到空字符串, 检测「全部
 * 通过」。造一条前 5 秒动、后 10 秒纯色的片子一验就现形: ffmpeg 明明打了
 * `freeze_start: 5`, 我这边解出 0 段。
 *
 * 一个永远不报警的检查比没有更坏, 这个项目里已经栽过一次(并排检测)。
 */
export async function runFreezeDetect(
  videoPath: string,
  opts: FreezeOpts = DEFAULT_FREEZE_OPTS,
  exec: (args: string[]) => Promise<{ stderr: string }> = defaultExec,
  totalSec?: number,
): Promise<FreezeSegment[]> {
  const { stderr } = await exec(buildFreezeDetectArgs(videoPath, opts));
  return parseFreezeOutput(stderr, totalSec);
}

async function defaultExec(args: string[]): Promise<{ stderr: string }> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    // freezedetect 把结果打在 stderr 上, 而且**正常退出** —— 所以两条路都要收
    execFile('ffmpeg', args, { maxBuffer: 1 << 24 }, (_err, _stdout, stderr) => {
      resolve({ stderr: stderr ?? '' });
    });
  });
}

export interface FreezeJudgement {
  ok: boolean;
  reason?: string;
}

/**
 * 整片判定。
 *
 * **按总占比而不是「有没有」**: 口播视频里本来就有讲道理时人不怎么动的镜头, 一段
 * 1~2 秒的静止是正常的节奏。真正的问题是「大面积死画面」。8% 这条线偏宽松 ——
 * 这一维刚接上, 先让它能报出来, 收紧要等有了真实分布再说(密度阈值就是因为第一次
 * 标定太紧, 反复返工了三轮)。
 */
export function judgeFreeze(segments: FreezeSegment[], totalSec: number): FreezeJudgement {
  if (segments.length === 0 || totalSec <= 0) return { ok: true };

  const frozen = segments.reduce((n, s) => n + s.durationSec, 0);
  if (frozen / totalSec <= MAX_FREEZE_RATIO) return { ok: true };

  const worst = [...segments].sort((a, b) => b.durationSec - a.durationSec).slice(0, 3);
  return {
    ok: false,
    reason:
      `全片有 ${frozen.toFixed(1)} 秒画面纹丝不动(占 ${(frozen / totalSec * 100).toFixed(0)}%)。` +
      `最长的几段在 ${worst.map((s) => `${s.startSec.toFixed(0)}s 起 ${s.durationSec.toFixed(1)}s`).join('、')}。`,
  };
}

/**
 * 落库/上界面用的整片静止报告。
 *
 * 单独一个纯函数而不是在 worker 里拼对象: 这个形状**界面要读**, 变了就是接口变了,
 * 得有测试盯着。`segments` 只留最长的几段 —— 界面上要的是「最坏的在哪几秒」,
 * 全量段数在一条 3 分钟的死画面片子上能有上百条, 存进库只是噪音。
 */
export interface FreezeReport {
  ok: boolean;
  /** 静止总时长(秒)。 */
  frozenSec: number;
  totalSec: number;
  /** 静止占比 0~1。 */
  ratio: number;
  /** 一共多少段(不是 worst 的长度)。 */
  count: number;
  /** 最长的几段, 供界面直接跳过去看。 */
  worst: FreezeSegment[];
  reason?: string;
  /** 量的是预览片还是正式成片 —— 两者画面可能不同(正式档 30fps, 预览 15fps)。 */
  kind: 'preview' | 'master';
  checkedAt: string;
}

/** 界面上最多列几段。多了没人看, 而且屏幕会被刷屏。 */
export const WORST_SEGMENTS_SHOWN = 3;

export function buildFreezeReport(
  segments: FreezeSegment[],
  totalSec: number,
  kind: 'preview' | 'master',
  checkedAt: string,
): FreezeReport {
  const frozenSec = segments.reduce((n, s) => n + s.durationSec, 0);
  const j = judgeFreeze(segments, totalSec);
  return {
    ok: j.ok,
    frozenSec,
    totalSec,
    ratio: totalSec > 0 ? frozenSec / totalSec : 0,
    count: segments.length,
    worst: [...segments].sort((a, b) => b.durationSec - a.durationSec).slice(0, WORST_SEGMENTS_SHOWN),
    reason: j.reason,
    kind,
    checkedAt,
  };
}
