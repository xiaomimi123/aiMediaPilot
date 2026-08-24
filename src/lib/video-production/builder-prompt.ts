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
  buildSystemPrompt(palette: string[], visualStyle: 'card' | 'illustration' = 'card', factsSection?: string): string {
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    const styleGuidance = visualStyle === 'illustration'
      ? '插画风格：手绘感矢量插画构图，扁平色块+简单人物/物件剪影+柔和过渡动画，避免写实照片风格，避免复杂运镜或隐喻。'
      : '第一版构图从简：文字卡片+简单几何图形+基础过渡（淡入淡出/位移）即可，不需要复杂运镜或隐喻。';
    return `你是一个"构建者"，用 HTML + GSAP 把一个镜头方案实现成一段可寻址、可确定性渲染的动画源码。不做创意决策，只忠实实现给定的镜头。

技术契约（必须严格遵守，渲染工具依赖这个契约来截帧）：
- 输出一个完整、自包含的单个 HTML 文件。
- 画布尺寸固定 1920x1080。
- 引入 <script src="gsap.min.js"></script>（本地文件已提供，不要用 CDN 或其它 <script src> 引用）。
- 用一个暂停态（paused: true）的 GSAP 主时间线，挂到 window.__timelines["shot"] 上，供外部脚本调用 tl.seek(seconds) 跳到任意时间点截帧。时间线总时长要覆盖这个镜头的完整时长（毫秒转秒）。
- 不要用 setTimeout/requestAnimationFrame 自驱动播放，画面状态必须完全由 GSAP timeline 的 seek 值决定。
- 中文用系统默认无衬线字体即可（不需要真实挂字体文件）。
- 严格使用给定调色板：${palette.join(', ')}，不要发明新颜色。
- ${styleGuidance}

${factsBlock}

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
