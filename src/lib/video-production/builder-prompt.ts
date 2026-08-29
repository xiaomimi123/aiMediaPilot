import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';
import type { Shot } from './director-prompt';

export const BuilderResponseSchema = z.object({
  html: z.string().min(1),
});
export type BuilderResponse = z.infer<typeof BuilderResponseSchema>;

export const BUILDER = {
  /**
   * `factsSection` 为空(或不传)时输出与二十期之前字符级一致 —— 老任务零迁移。
   * 非空时由 `buildFactsSection` 产出, 自带前导换行。Builder 是幻觉数字真正落到画面上的
   * 那一层(实测它会把台词里的"好几倍"编成带货币符号的对比表), 护栏必须下到这里。
   */
  buildSystemPrompt(
    palette: string[],
    visualStyle: 'card' | 'illustration' = 'card',
    factsSection?: string,
    chapterNavSection?: string,
    /**
     * 真实画布。**必须跟着成片走, 不能写死。**
     *
     * 真机上出过这个: 用户拍的是 1080x1920 竖屏, 而每个 B-roll 镜头都按 1920x1080
     * 横屏渲染, 合成时等比缩进竖屏画面 —— 内容只剩 32% 的高度, 其余 68% 全是黑边。
     * 光改渲染视口不够: 模型按横屏排的版塞进竖屏视口会溢出/被裁, 所以画布尺寸必须
     * 同时写进 prompt。
     */
    frame: { width: number; height: number } = { width: 1920, height: 1080 },
  ): string {
    const portrait = frame.height > frame.width;
    /*
     * 竖屏的排版规则要说得很具体, 因为实测的问题是**版面没铺开**, 不是内容不够。
     *
     * 量过一版真实成片: 把画面切成五条横带, 内容占比是 7% / 24% / 29% / 2% / 0%
     * —— 八帧里六帧的下半部分完全空着。元素全挤在上半屏, 底下白白浪费。
     *
     * 注意这里**不是**要它"堆更多东西": 密度阈值那边记着一次教训 —— 拿参考片的
     * 峰值当每帧及格线, 模型收到"你只有 5.6%, 人家 30%"之后无所适从, 越改越乱,
     * 甚至排出纯空屏。所以这里只说**同样的内容摊到多大的高度上**, 不提密度。
     *
     * 底部 20% 必须空着: 字幕在打包阶段烧在那里, 元素放进去会被盖住。
     */
    // 0.85 而不是 0.8: 字幕实际只占 93%~95%(marginV 90 + 字号 44), 留 15% 太浪费
    const usableH = Math.round(frame.height * 0.85);
    const canvasLine = portrait
      ? [
          `- 画布尺寸固定 ${frame.width}x${frame.height}(**竖屏**)。`,
          `- 纵向排版: 元素上下堆叠、通栏铺满宽度, **不要左右分栏** —— 竖屏里并排两栏每栏只有 ${Math.round(frame.width / 2)}px, 字会挤成一条。`,
          `- **版面的上下两端都要卡准**: 最上面那个元素的顶边落在 ${Math.round(frame.height * 0.05)}px ~ ${Math.round(frame.height * 0.15)}px 之间, 最下面那个元素的底边落在 ${Math.round(frame.height * 0.65)}px ~ ${usableH}px 之间。`,
          `- 中间不要留大片空白: 同样这些内容, 拉开行距、放大字号、把元素分层摊到这段高度上。**既不要全堆在顶上, 也不要全压到底下** —— 两种都错, 只是错的方向相反。`,
          `- **把卡片放大不算把版面排开**: 一个占了大半屏、里面只有三四个元素的空盒子, 比堆在顶上更糟。要摊开的是内容本身。`,
          `- 最底下 ${Math.round(frame.height * 0.1)}px(画面 90% 以下)**必须留空**: 字幕烧在 93%~95% 那一带, 放元素会被盖住。`,
        ].join('\n')
      : `- 画布尺寸固定 ${frame.width}x${frame.height}。`;
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    // 章节进度条(二十一期): 由模板 showChapterNav 驱动; 空串时输出不变
    const navBlock = chapterNavSection && chapterNavSection.trim() ? chapterNavSection : '';
    const styleGuidance = visualStyle === 'illustration'
      ? '插画风格：手绘感矢量插画构图，扁平色块+简单人物/物件剪影+柔和过渡动画，避免写实照片风格，避免复杂运镜或隐喻。'
      : '第一版构图从简：文字卡片+简单几何图形+基础过渡（淡入淡出/位移）即可，不需要复杂运镜或隐喻。';
    return `你是一个"构建者"，用 HTML + GSAP 把一个镜头方案实现成一段可寻址、可确定性渲染的动画源码。不做创意决策，只忠实实现给定的镜头。

技术契约（必须严格遵守，渲染工具依赖这个契约来截帧）：
- 输出一个完整、自包含的单个 HTML 文件。
${canvasLine}
- 引入 <script src="gsap.min.js"></script>（本地文件已提供，不要用 CDN 或其它 <script src> 引用）。
- 用一个暂停态（paused: true）的 GSAP 主时间线，挂到 window.__timelines["shot"] 上，供外部脚本调用 tl.seek(seconds) 跳到任意时间点截帧。时间线总时长要覆盖这个镜头的完整时长（毫秒转秒）。
- 不要用 setTimeout/requestAnimationFrame 自驱动播放，画面状态必须完全由 GSAP timeline 的 seek 值决定。
- 中文用系统默认无衬线字体即可（不需要真实挂字体文件）。
- 严格使用给定调色板：${palette.join(', ')}，不要发明新颜色。
- 可读性硬约束（比构图好看优先）：同一时刻，文字/图形与它正后方的背景**不许用同一个色值**；背景色如果在时间线中途变了，前景色必须同步改成对比色（亮底配深色字，深底配亮色字）。调色板里同时有深色和亮色，选错组合会让整屏什么都看不见。
- 镜头的任何时刻都必须有可读内容：不许出现整屏纯色、没有任何文字或图形的空屏时间段；动画结束后画面要停在有内容的终态，而不是淡出成空白。
- ${styleGuidance}

${navBlock}${factsBlock}

只输出这一个 HTML 文件的完整内容，不要输出任何解释文字、不要用 markdown 代码块包裹，直接从 <!DOCTYPE html> 开始到 </html> 结束。`;
  },
  buildUserMessage(shot: Shot): ContentPart[] {
    const beatsText = shot.beats.map((b, i) => `${i + 1}. 画面变成: ${b.visibleState}；变化: ${b.development}`).join('\n');
    return [{
      type: 'text',
      text: `实现这个镜头（时长 ${(shot.endMs - shot.startMs) / 1000} 秒，时间线 id 用 "shot"）：\n\n主张: ${shot.claim}\n视觉任务: ${shot.visualJob}\n\n微节拍：\n${beatsText}\n\n从 0 秒开始，前面没有任何画面。`,
    }];
  },
  responseSchema: BuilderResponseSchema,
};
