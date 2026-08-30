/**
 * 按实测人脸位置算文字安全带(二十三期)。
 *
 * **它推翻了 `text-zone.ts` 里我写下的一个判断。** 那里原话是:
 *
 * > 人在哪边由人设定, 不假装能自动识别: 真做人像分割要 matting, 是另一个量级的
 * > 工程, 而猜错的代价是字直接糊在脸上。
 *
 * 错在把「避开人脸」当成了「分割人像」。避开人脸只需要人脸的 bbox —— YuNet 模型
 * 230KB、纯 CPU、每帧几毫秒。代价被高估了一个量级, 于是这件本该量出来的事被交给了
 * 模板里手填的「人在左/中/右」, 而手填会填错, 填错就是字糊在脸上。
 *
 * **两个实测结论, 都和最初的设想不一样:**
 *
 * 1. **静态安全区不成立。** 真实素材里 76 个检出框尺寸高度一致(547x601, ±6%),
 *    但位置横跨几乎整幅画面(x −2~1077, y 20~1715) —— 人在 155 秒里一直在动。全时段
 *    并集覆盖 95% 画面, 按它排一个字都放不下。所以要**按时间窗口**算: 每条文字叠加
 *    都有自己的起止时间, 只需要那几秒里脸不在的位置。
 * 2. **检出门槛不能只调高。** 0.7 只检出 38%(侧脸、低头全漏), 而漏检让安全区偏小,
 *    偏小比没有更危险 —— 字会正好压在漏掉的那些帧的脸上。改成 0.5 拿高召回, 误检
 *    靠尺寸一致性剔除(脚本侧 `filter_outliers`)。
 */

export interface FaceSample {
  /** 采样时刻(秒)。 */
  t: number;
  /** 素材像素系的人脸框 [x, y, w, h]。 */
  face: [number, number, number, number];
}

export interface FaceReport {
  detectRate: number;
  /** 检出率够不够高。不够时调用方应当退回手填的 personSide。 */
  reliable: boolean;
  samples: FaceSample[];
}

/** 解析脚本输出。**坏数据返回 null 而不是抛** —— 它只是个可选的增强, 不该拖垮出片。 */
export function parseFaceReport(json: string): FaceReport | null {
  try {
    const raw = JSON.parse(json) as {
      detect_rate?: number;
      reliable?: boolean;
      samples?: FaceSample[];
    };
    return {
      detectRate: raw.detect_rate ?? 0,
      reliable: raw.reliable ?? false,
      samples: Array.isArray(raw.samples) ? raw.samples : [],
    };
  } catch {
    return null;
  }
}

export interface Band {
  y: number;
  height: number;
}

export interface SafeBands {
  /** 人脸之上那条横带; 放不下时为 null。 */
  top: Band | null;
  /** 人脸之下那条横带; 放不下时为 null。 */
  bottom: Band | null;
}

/** 人脸框向外扩多少才算安全: 上方留头发和举手, 下方留下巴和肩。 */
const PAD_TOP = 0.6;
const PAD_BOTTOM = 0.2;
const PAD_PX = 30;

/** 一条带窄于这个就没法放字了。 */
const MIN_BAND = 100;

/**
 * 算出 `[startMs, endMs)` 这段时间里, 文字可以放的横带。
 *
 * **只取窗口内的采样点。** 这是这个函数存在的全部理由 —— 全片并集会被某一秒里
 * 人凑到镜头前的那一帧毁掉, 而那一帧和「第 12 秒要显示的那行字」毫无关系。
 *
 * 窗口里一个采样点都没有时返回两个 null: 那不代表安全, 只代表不知道, 调用方应当
 * 退回手填的 personSide 而不是当成随便放。
 */
export function safeBandFor(
  samples: FaceSample[],
  startMs: number,
  endMs: number,
  frame: { width: number; height: number },
): SafeBands {
  const inWindow = samples.filter((s) => s.t * 1000 >= startMs && s.t * 1000 < endMs);
  if (inWindow.length === 0) return { top: null, bottom: null };

  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const s of inWindow) {
    const [, y, , h] = s.face;
    top = Math.min(top, y - h * PAD_TOP - PAD_PX);
    bottom = Math.max(bottom, y + h + h * PAD_BOTTOM + PAD_PX);
  }

  const topBand = top >= MIN_BAND ? { y: 0, height: Math.round(Math.min(top, frame.height)) } : null;
  const bottomH = frame.height - bottom;
  const bottomBand =
    bottomH >= MIN_BAND ? { y: Math.round(Math.max(0, bottom)), height: Math.round(bottomH) } : null;

  return { top: topBand, bottom: bottomBand };
}
