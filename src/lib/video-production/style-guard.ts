/**
 * 模板风格 → 画面层提示词(二十一期)。
 *
 * 依据是同行参考视频的实测拆解(docs/superpowers/specs/2026-08-25-reference-video-teardown.md):
 * 参考视频是米白亮底 + 深色字(帧均值亮度 215)、2.8~6 秒就有一次画面变化、顶部常驻
 * 六章进度条;而我们原来固定深蓝底白字、每镜 10 秒、无任何结构装置。
 *
 * 三个函数都遵循同一约定: 关闭/缺省时返回空串, 上游 prompt 与改动前字符级一致。
 */

export interface TemplateVisualStyle {
  visualTone: 'light' | 'dark';
  shotPaceSec: number | null;
}

/** Director 用: 影响调色板生成与切镜频率。 */
export function buildStyleSection(style: TemplateVisualStyle | null): string {
  if (!style) return '';

  const lines: string[] = [];

  if (style.visualTone === 'light') {
    lines.push(
      '- 画面基调用**亮底**: 调色板必须以浅色(米白/浅灰/接近白)作为大面积背景色, 文字与图形用深色。不要产出深色背景 + 浅色文字的组合。',
    );
  }

  if (style.shotPaceSec) {
    lines.push(
      `- 切镜节奏: 平均每 ${style.shotPaceSec} 秒左右就要有一次明显的画面变化, 单个镜头不要超过 ${Math.max(style.shotPaceSec * 2, 8)} 秒——这条**覆盖上面"单个镜头不超过 40000 毫秒"的上限**, 以更短的为准。一个画面停十秒观众就划走了。`,
    );
  }

  if (lines.length === 0) return '';
  return `\n\n本条内容套用的模板对画面风格有额外要求:\n${lines.join('\n')}`;
}

export interface ChapterAct {
  act: string;
  title: string;
}

/**
 * 某个毫秒位置落在哪一幕。
 *
 * 幕边界按 `targetSec` 累加算 —— `synthesizeSrtFromSixActScript` 就是这么铺时间轴的
 * (逐幕推进 cursor, 每幕内部再按字数分句), 所以这里的累加与 SRT 的时间轴同源。
 * 超出末尾时归入最后一幕(而不是返回 null): 分镜的 endMs 可能因取整略微越界。
 */
export function actAtMs(
  acts: Array<{ act: string; targetSec: number }>,
  ms: number,
): string | null {
  if (acts.length === 0) return null;
  let cursor = 0;
  for (const a of acts) {
    cursor += a.targetSec * 1000;
    if (ms < cursor) return a.act;
  }
  return acts[acts.length - 1].act;
}

/**
 * Builder 用: 常驻章节进度条。
 *
 * 参考视频顶部有一条章节导航贯穿全片并高亮当前章, 观众任何时候都知道讲到哪、还剩多少 ——
 * 对超过两三分钟的知识视频, 这是留存的关键结构装置。我们的六幕结构天然就是这六章。
 */
export function buildChapterNavSection(
  enabled: boolean,
  acts: ChapterAct[],
  currentAct: string | null,
): string {
  // 拿不到幕信息时宁可不画, 也不要画一条只有半截、或者高亮不出当前位置的假导航。
  if (!enabled || acts.length === 0) return '';

  // 真实出片踩过: 早先把当前章标成 `标题【当前】` 一并写进列表, Builder 把标记
  // 当成章节名的一部分照抄进了画面, 顶部出现「普通人怎么应对【当前】」。
  // 改为章节名保持干净原文, 用**序号**在正文里另行指明高亮哪一个。
  const list = acts.map((a, i) => `${i + 1}. ${a.title}`).join(' / ');
  const currentIndex = acts.findIndex((a) => a.act === currentAct);
  const highlight = currentIndex >= 0 ? currentIndex + 1 : 1;

  return `\n\n本镜头必须画一条常驻章节进度条:
- 位置在画面顶部, 一行排开全部章节: ${list}
- **高亮第 ${highlight} 章**(加粗/变色/加下划线均可), 其余章节弱化为次要色。
- 画上去的章节名只写标题本身, 上面的序号和这段说明文字都**不要**画进画面。
- 这条进度条在本镜头**全程常驻**, 不许中途淡出或被其它元素遮挡; 它是观众判断"讲到哪了、还剩多少"的唯一依据。
- 进度条占高度不超过画面的 8%, 不要喧宾夺主。`;
}
