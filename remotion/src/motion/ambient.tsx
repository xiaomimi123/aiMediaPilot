import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

/**
 * 环境运动层(二十六期)——全片底噪, 保证没有一帧是彻底静止的。
 *
 * **不是 `env.tsx` 的 `Environment` 参数化版, 是另写的一个干净实现。**
 * `Environment` 里的 `ACTS`/`EXPOSURE_HITS`/`TRANSITION_FLASHES`/`VIGNETTE_TIGHTEN`
 * 全部是按 video-talkcraft 那条片子的具体戏剧节拍(第几秒进入反转、第几秒给一个
 * 曝光高光)写死的绝对秒数表——那是"别人那条片子"的剪辑决定, 我们的 `filmPlan`
 * 由 Builder 按内容动态生成, 镜数/时长都不固定, 硬套一张按秒数写死的节拍表只会
 * 在我们的内容上出现"该反转的地方没反转、不该给高光的地方给了高光"的错位。
 * 能抽出来复用的只有两条**结构性结论**(要有变化率、要有单调项填洞), 数值和
 * 节拍表都不带过来——这正是任务里"不要照搬旧参数"那条约束。
 *
 * ## 参数怎么测出来的
 *
 * 完整 A/B 表格见 `.superpowers/sdd/2026-08-31-remotion-foundation/ambient-layer-report.md`,
 * 用的是 Task 5 那条 14 秒三镜 filmPlan(`statement`→`stat`→`contrast`), 每改一版
 * 参数就整片渲一次、跑一次 `freezedetect` 实测, 不是先验设定。几个反直觉的发现:
 *
 * - **旧管线的"8s 慢呼吸"这套频率搬过来不成立。** 直接复现过: `breatheSec`
 *   拉到 2.6s、振幅 0.03, 单独开(甚至叠加一版慢速局部光带)都会在正弦折返点
 *   附近留 0.8~1.7s 的静止段(累积变化量被 `noise=0.003` 的容差吃掉)——这一步
 *   复现了 `ambient-rig.ts` 头部注释记的结论, 只是把频率换成这条新管线自己的
 *   数字, 结论没变。
 * - **真正决定成败的是频率, 不是"单调 vs yoyo"这个分类本身。** 把 `breathe`
 *   的周期从 2.6s 提到 1.7s(振幅仍是 0.04 那么浅), **单独这一项就已经把静止
 *   压到 0%**——因为周期短到"正弦导数趋零"的那个窗口本身撑不满 freezedetect
 *   0.8s 的判定下限, 中间总会被下一段"导数明显不为零"的区间打断。这与旧结论
 *   (慢 yoyo 不够)并不矛盾, 只是旧结论成立的前提(慢周期)在这里被换掉了。
 * - **局部对角光带(sweep)单独开在这条样片上不够**(见报告 A/B 表: 单独开
 *   sweep, 各种周期/幅度组合都只把静止压到 60%~77%)。原因是它只覆盖屏幕
 *   ~44% 的面积, freezedetect 量的是整帧平均差异, 被局部覆盖 + 低幅度双重
 *   稀释后达不到 `noise` 阈值——不是"单调项天然管用", 面积和幅度都要够。
 * - **仍然保留 sweep 叠加, 是为了不把整条产线的鲁棒性押在一次样片的相位运气
 *   上。** 这条 14 秒三镜样片恰好没有撞上"呼吸折返点 + 镜切点"的最坏相位
 *   组合, 但 Builder 产的镜长是动态的, 不能保证每一条真实 `filmPlan` 都这么
 *   幸运。`sweep`(锯齿光带, 1.5s 一个周期, 周期内单调)提供任何时刻都不为零
 *   的变化率, 兜住"呼吸恰好撞上镜切点"这类没被这条样片测到的相位组合——这是
 *   任务里"能借结构性结论, 不能借数值"那条约束要保留的安全边际, 不是为了
 *   凑指标而多加的装饰。
 * - **每镜的 `CameraRig` 缓慢推近(见 `Film.tsx` 的 `CAMERA_PUSH_IN`)是第二重
 *   单调项**, 且天然按"这一镜多长"归一化、不受镜长变化影响——比 `Ambient`
 *   自己的锯齿更可靠, 双保险。
 *
 * 呼吸振幅(`breatheAmp`)与光带峰值(`sweepPeak`)都压得很浅: 新框架下卡片自身
 * 已经有入场动效 + 数字滚动 + `Live` 的 idle 抖动, 环境层只需要补足"整镜没有
 * 卡片自身动效在推进"的空档, 幅度大了会和卡片自己的动效叠加出"画面在晃"的
 * 观感——这是任务里明确要避免的反面(指标达标但发飘)。抽帧核对过: 呼吸引起的
 * 明暗浮动、光带扫过的痕迹都在"肉眼几乎察觉不到、但仪器测得到"这个区间。
 */
export const AMBIENT = {
  /** 呼吸(vignette 明暗)一个完整周期的秒数。实测: 2.6s 会在折返点留静止段,
   * 1.7s 不会——因为周期短到"导数趋零"的窗口撑不满 freezedetect 0.8s 的判定
   * 下限。没有再往下压是因为 1.7s 已经达标, 更快只会增加"画面在闪"的风险,
   * 不再有收益。 */
  breatheSec: 1.7,
  /** 呼吸振幅(vignette 强度 0~1 里的浮动量)。0.04——肉眼基本看不出明暗跳动,
   * 只提供 freezedetect 能测到的像素级变化。 */
  breatheAmp: 0.04,
  /** vignette 基础强度——只在四角略微收暗, 不影响中央可读区。 */
  vignetteBase: 0.22,
  /** 对角光带扫过一整屏的周期(秒)。1.5s, 取模产生锯齿, 每个周期内单调,
   * 折返瞬间有个跳变但那本身不是"静止", freezedetect 不会因此报警。作用是
   * 兜住呼吸的相位盲区, 而不是自己单独扛指标(它自己也测过不够, 见上方
   * 与报告里的 A/B 表)。 */
  sweepSec: 1.5,
  /** 光带自身的不透明度峰值——刻意很浅, 观感上几乎察觉不到"有条带在扫",
   * 只在暗部留一点点温度变化。 */
  sweepPeak: 0.11,
} as const;

/**
 * 全片环境层。画在卡片之上、`pointerEvents: none`, 不吃任何交互, 也不携带任何
 * 与内容绑定的秒数表——纯粹是"这一帧和上一段时间相比总有一点点在变"。
 *
 * 用 `useVideoConfig` 的 `fps` 换算秒数, 不读 `width`/`height`——本层全部用
 * 百分比/角度描述, 天然随画幅自适应, 横屏竖屏共用同一份实现。
 */
export const Ambient: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sec = frame / fps;

  // yoyo 项: 正弦呼吸, 提供"手感", 频率足够高时折返点的洞本身就撑不满判定下限。
  const breathePhase = 0.5 + 0.5 * Math.sin((sec / AMBIENT.breatheSec) * Math.PI * 2);
  const vignette = AMBIENT.vignetteBase + breathePhase * AMBIENT.breatheAmp;

  // 单调项: 取模锯齿, 周期内恒定斜率, 兜住呼吸相位盲区(双保险, 见上方注释)。
  const sweepPos = ((sec % AMBIENT.sweepSec) / AMBIENT.sweepSec) * 220 - 60;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {/* 对角光带: 单调项 */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(102deg, transparent ${sweepPos - 22}%, rgba(200, 220, 255, ${AMBIENT.sweepPeak}) ${sweepPos}%, transparent ${sweepPos + 22}%)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* 呼吸 vignette: yoyo 项 */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 50%, transparent ${Math.max(30, 62 - vignette * 60)}%, rgba(4, 8, 16, ${Math.min(0.5, vignette * 1.4)}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
