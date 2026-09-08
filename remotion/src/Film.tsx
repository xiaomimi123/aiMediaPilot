import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useVideoConfig} from 'remotion';
import {CARDS} from './cards';
import {Ambient} from './motion/ambient';
import {CameraRig} from './motion/camera';
import {Captions} from './Captions';
import {THEMES} from './theme';
import {mergeShotStyle} from './cards/style';

/**
 * 每镜的单调推近幅度(二十六期, 补环境运动层缺口)。
 *
 * 用 `CameraRig` 给每一镜的画面套一段整镜时长内单调递增的缓慢放大——这是
 * "单调项"天然的来源(见 `motion/ambient.tsx` 顶部注释里的 A/B 结论: 只有 yoyo
 * 呼吸会在正弦折返点留洞, 需要一个恒定斜率的分量填住)。放在 Film 层而不是塞进
 * `Ambient` 本身, 是因为推近需要按"这一镜多长"归一化(`CameraRig` 的 `durationSec`
 * 参数本来就是这么设计的), 而 `Ambient` 是无镜头感知的全局叠加层。
 *
 * 实测(见 ambient-layer-report.md): 4.5%~5% 的放大量, 在 5 秒左右的镜头里
 * 肉眼几乎看不出"在推镜", 但已经是 freezedetect 能稳定测到的像素变化率;
 * 加到 8%+ 在 statement 这类长文字镜上开始能看出画面在慢慢变大, 观感变得
 * 不安分——所以没有再往上加。**镜与镜之间会跳变一次**(`CameraRig` 按
 * `durationSec` 归一化、每镜从 scale=1 重新起跑), 但那正是切镜本身的边界,
 * 不是无端的抖动, 抽帧检查过没有观感问题。
 */
const CAMERA_PUSH_IN = 0.045;

/** 一句字幕(二十八期)。startMs/endMs 是相对全片的绝对时间, 不是相对某一镜。 */
export type CaptionItem = {
  text: string;
  startMs: number;
  endMs: number;
  /**
   * 词级时间戳(二十九期 Task 5, 可选)——`words` 缺省时 `Captions.tsx` 保持
   * 老行为(整句一起显示, 不做逐词高亮)。只有 ppt-narration/illustration-tts
   * 两条 TTS 链会填这个字段(worker 侧字级对齐, 见
   * `src/lib/video-production/align-captions.ts`); talking-head-broll(出镜链)
   * 的音频是真人自由发挥、没有已知文本可锚定, 不产这份数据, 这里恒为 `undefined`。
   * `word` 通常是单个汉字, 数字/百分比/区间/年份会合并成一个整体词(比如
   * "1850%")——与显示文本 `text` 里的原文写法完全一致, 不是对齐用的中文读法。
   */
  words?: {word: string; startMs: number; endMs: number}[];
};

/**
 * 单镜样式覆盖(三十二期 Task 3)——与
 * `src/lib/video-production/shot-plan.ts` 的 `ShotStyleSchema` 逐字段同形,
 * **不 import**(独立子项目, 理由同 `CaptionItem`/`sourceVideo`)。模型不填,
 * 只有剪辑台(用户)会写它, 详见 shot-plan.ts 的 `ShotStyleSchema` 注释。
 */
export type FilmShotStyle = {
  speed?: number;
  accent?: 'default' | 'blue' | 'yellow' | 'red';
  scale?: number;
};

export type FilmInput = {
  shots: {shotId: string; startMs: number; endMs: number; card: keyof typeof CARDS; slots: any; style?: FilmShotStyle}[];
  audioSrc: string | null; // 人声, staticFile 相对路径; renderFilm 负责填入
  bgm: {src: string; volume: number} | null; // BGM, loop 到片长; renderFilm 负责填入
  captions: CaptionItem[]; // 逐句字幕, 缺省 []
  aspect: '16:9' | '9:16';
  /**
   * 模板级默认样式(三十六期 Task 3)——与逐镜 `shots[].style` 合并的唯一
   * 输入口子(合并逻辑见 `./cards/style` 的 `mergeShotStyle`, 唯一合并点在
   * 下方渲卡处)。可选、缺省 `undefined`——大多数任务没有模板或模板没配置
   * 默认样式, 这种情况下行为与三十六期之前完全一致(`mergeShotStyle` 对
   * `undefined` 输入返回逐镜 style 原样, 见该函数注释)。
   */
  templateStyle?: FilmShotStyle;
  /**
   * 卡面视觉风格(二十九期 Task 1)——`'card'` 是四张卡目前的默认配色,
   * `'illustration'` 是给 illustration-tts 迁移用的暖纸/手写感配色, 见
   * `theme.ts`。刻意必填(不给默认值): 逼未来任何新调用点显式想清楚这条片子
   * 该用哪套风格, 不让静默缺省替他做决定——与 `bgm`/`captions` 同一惯例。
   */
  visualStyle: 'card' | 'illustration';
  /**
   * 出镜视频层(二十九期 Task 3)——真人出镜视频铺底, 卡片按分镜时间窗覆盖
   * (挖空替换的原生实现)。与 `bgm`/`captions`/`visualStyle` 同一惯例:
   * 刻意必填(不给默认值), 逼调用点显式传 `null` 而不是静默缺省。
   *
   * `layout`:
   * - `'cutaway'`: 顺序挖空——出镜视频全程铺底, shots 时间窗内卡片整幅盖上
   *   把人像替换掉, 窗口外露出出镜画面。对应旧链 `compositeCutawayVideo`
   *   不传 `pip` 的分支(`src/lib/video/ffmpeg.ts`)。
   * - `'pip'`: 画中画——卡片轨照旧全程运行(含 Ambient/字幕), 出镜视频缩成
   *   角标常驻叠在卡片之上。对应旧链 `compositeCutawayVideo` 传 `pip` 的分支。
   *
   * `pip` 字段仅 `layout==='pip'` 时必填, 语义与 `VideoTemplate.pipPosition/
   * pipScale/pipMargin`(`prisma/schema.prisma`)逐字段对齐: `position` 取值
   * `'tl'|'tr'|'bl'|'br'`(与 `src/lib/video/pip-layout.ts` 的 `PipPosition`
   * 同形, 独立子项目不 import, 理由同 `CaptionItem`), `scale` 是小窗宽度占
   * 画面宽度的比例, `margin` 是离边缘的像素距离。
   */
  sourceVideo: {
    src: string; // staticFile 相对路径, renderFilm 负责填入
    layout: 'cutaway' | 'pip';
    pip: {
      position: 'tl' | 'tr' | 'bl' | 'br';
      scale: number;
      margin: number;
      /**
       * 小窗形状(二十九期 Task 6 用户验收返工, 可选)——与
       * `src/lib/video-production/remotion-render.ts` 的 `FilmInput.sourceVideo.pip.shape`
       * 逐字段同形(独立子项目, 不 import, 理由同 `CaptionItem`)。模板目前没有
       * 对应字段, worker 暂时写死传 `'rounded'`; 缺省(`undefined`)时这里也按
       * `'rounded'` 处理(见下方 `resolveShape` 常量)。`'circle'` 分支已经实现好,
       * 只是暂时没有输入通路——将来模板加字段就能直接用。
       */
      shape?: 'rounded' | 'circle';
    } | null;
  } | null;
};

/**
 * 出镜视频画幅适配(对齐旧链行为)。
 *
 * 旧链 `compositeCutawayVideo`(`src/lib/video/ffmpeg.ts:317` 附近)把尺寸不一致的
 * B-roll 片段对齐进源视频画幅时, 用的是
 * `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:...:color=black`——
 * 即"等比缩放到能装进目标框、多出的空间用黑边填充", **不裁切**。这里是反过来的
 * 场景(出镜视频要装进合成画幅), 但同一条取舍成立: 竖屏合成配横屏出镜素材时,
 * 用 `cover` 会裁掉画面两侧(旧链从未这么做过), 所以选 `objectFit: 'contain'` +
 * 父容器黑底, 复现旧链"留黑边不裁切"的观感, 不引入新的裁剪行为。
 */
const CUTAWAY_VIDEO_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

/** 画中画角标定位(二十三期 `computePipRect` 的 Remotion 等价物)。 */
const PIP_POSITION_STYLE: Record<'tl' | 'tr' | 'bl' | 'br', (margin: number) => React.CSSProperties> = {
  tl: (m) => ({top: m, left: m}),
  tr: (m) => ({top: m, right: m}),
  bl: (m) => ({bottom: m, left: m}),
  br: (m) => ({bottom: m, right: m}),
};

/**
 * 画中画小窗"浮层自然感"视觉规格(二十九期 Task 6 用户验收返工)。
 *
 * 用户原话: "人物是浮在上面一个圆形的窗口(方形窗口也好)"——旧版是直角矩形硬贴
 * 在画面上, 观感是"贴"而不是"浮"。加圆角/圆形 + 细白描边 + 投影是三件一起做才
 * 成立的组合(单独加圆角还是像贴纸, 单独加投影还是硬边框): 描边给小窗一条清晰
 * 但不抢戏的轮廓, 投影把它从背景"提起来"一层。数值取常见 PIP/摄像头小窗观感
 * 区间, 非精确测算, 三帧抽查确认过不违和:
 * - 圆角矩形的圆角 = 小窗宽度的 10%(用户给的 8~12% 区间取中)。
 * - 描边 2.5px、rgba(255,255,255,0.9)——细、够亮、半透明留一点柔和感。
 * - 投影 `0 8px 24px rgba(0,0,0,0.25)`——足够让小窗"浮起来", 不做成阴影很重的
 *   立体拟物风格。
 */
const PIP_BORDER_RADIUS_RATIO = 0.1;
const PIP_BORDER = '2.5px solid rgba(255, 255, 255, 0.9)';
const PIP_SHADOW = '0 8px 24px rgba(0, 0, 0, 0.25)';

/**
 * 顶层合成(Task 4 接入卡片; 二十八期接人声/BGM/字幕层)。画面不再是占位的
 * 宽高数字, 而是按 shots 时间轴挑卡片、把槽位喂给对应组件 —— 版面由卡片组件
 * 保证, Film 只负责排布时间轴。
 *
 * `FilmInput.bgm`/`captions` 是**必填字段**——所有调用点(worker、
 * ambient-layer 测试)都已显式改成传 `bgm: null, captions: []`。这里的
 * `= null`/`= []` 只是组件层面的防御性默认值(万一将来有调用方绕过类型检查
 * 直接拿 JSON 喂进来), 不是"旧调用不用改"的免检特权。
 *
 * 刻意选必填而不是可选(`?`): 必填能让 tsc 在未来任何新调用点上, 强制作者
 * 显式想清楚"这条片子要不要字幕/BGM", 而不是让静默缺省替他做了决定。
 */
export const Film: React.FC<FilmInput> = ({
  shots,
  audioSrc,
  bgm = null,
  captions = [],
  visualStyle,
  sourceVideo = null,
  templateStyle,
}) => {
  const {fps, width, height} = useVideoConfig();
  const theme = THEMES[visualStyle];
  const isCutaway = sourceVideo?.layout === 'cutaway';
  const isPip = sourceVideo?.layout === 'pip';

  /*
   * 贴底 pip 小窗对字幕安全区的挤占(二十九期 Task 6 用户验收返工)——见
   * `Captions.tsx` 的 `pipReserve` prop顶部注释: 只有贴底锚定(`bl`/`br`)才
   * 无条件让出这一侧横向空间, 顶部锚定(`tl`/`tr`)不处理, 传 `undefined`
   * 保持老行为。
   */
  const pipReserve: {side: 'left' | 'right'; width: number} | undefined =
    isPip && (sourceVideo!.pip!.position === 'bl' || sourceVideo!.pip!.position === 'br')
      ? {
          side: sourceVideo!.pip!.position === 'bl' ? 'left' : 'right',
          width: Math.round(width * sourceVideo!.pip!.scale) + sourceVideo!.pip!.margin,
        }
      : undefined;

  const cardsTrack = (
    <>
      {shots.map((s) => {
        const Card = CARDS[s.card];
        const from = Math.round((s.startMs / 1000) * fps);
        const dur = Math.round(((s.endMs - s.startMs) / 1000) * fps);
        const durationSec = dur / fps;
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur}>
            {isCutaway ? (
              /*
               * cutaway 专属: 各卡片组件(Statement/Stat/...)自身没有不透明
               * 背景——平时靠 Film 顶层 AbsoluteFill 的全局背景色垫底"看起来
               * 不透明"。但 cutaway 下顶层背景已经让位给出镜视频(见上方
               * `isCutaway ? '#000' : theme.background'`), 如果不额外垫一层,
               * 卡片文字之外的区域会露出下面的视频——"卡片全幅盖住视频"就
               * 不成立了。这里在每个 Sequence 窗口内单独补一块 `theme.background`
               * 的不透明底, 只在窗口时长内存在, 窗口外(Sequence 未挂载)视频
               * 照常可见。
               */
              <AbsoluteFill style={{backgroundColor: theme.background}} />
            ) : null}
            <CameraRig
              path={[
                {t: 0, scale: 1},
                {t: durationSec, scale: 1 + CAMERA_PUSH_IN},
              ]}
              durationSec={durationSec}
            >
              <Card slots={s.slots} durationInFrames={dur} theme={theme} style={mergeShotStyle(templateStyle, s.style)} />
            </CameraRig>
          </Sequence>
        );
      })}
      {/* 环境运动层(二十六期): 全片底噪, 保证没有一帧彻底静止。见 motion/ambient.tsx。 */}
      <Ambient />
    </>
  );

  return (
    <AbsoluteFill style={{backgroundColor: isCutaway ? '#000' : theme.background}}>
      {isCutaway ? (
        <>
          {/*
           * cutaway: 出镜视频**不套 Sequence**, 全程挂载——spike 已验证不透明
           * div 覆盖画面不会卸载 OffthreadVideo, 音轨全程连续(人声不断)。放在
           * cardsTrack 之前, 让卡片在自己的时间窗内用整幅不透明背景盖住它。
           */}
          <OffthreadVideo src={staticFile(sourceVideo!.src)} style={CUTAWAY_VIDEO_STYLE} />
          {cardsTrack}
        </>
      ) : isPip ? (
        <>
          {cardsTrack}
          {/*
           * pip: 出镜视频角标常驻, 必须在卡片轨之后渲染才不会被卡片整幅背景盖住。
           *
           * `sourceVideo.pip.scale`/`margin` 在这里直接使用, 不再重复 clamp——
           * 旧链 `computePipRect`(`src/lib/video/pip-layout.ts`)那套 clamp
           * (`scale` 夹到 [PIP_SCALE_MIN=0.12, PIP_SCALE_MAX=0.45]、`margin`
           * 夹到 >= 0)已经在二十九期 Task 4 worker 接线处
           * (`handleTalkingHeadBrollRemotion`, 从 `VideoTemplate.pipPosition/
           * pipScale/pipMargin` 读值那一步)做过, 传到这里的值已经是合法范围
           * 内的值——Film.tsx 是渲染层, 不重复做调用方已经保证过的校验。
           */}
          {(() => {
            // shape 缺省按 'rounded' 处理(见 FilmInput.sourceVideo.pip.shape 顶部注释)。
            const shape = sourceVideo!.pip!.shape ?? 'rounded';
            const isCircle = shape === 'circle';
            const pipWidth = Math.round(width * sourceVideo!.pip!.scale);
            return (
              <div
                style={{
                  position: 'absolute',
                  ...PIP_POSITION_STYLE[sourceVideo!.pip!.position](sourceVideo!.pip!.margin),
                  width: pipWidth,
                  /*
                   * 'rounded'(圆角矩形): 高度故意不写死, 让浏览器按视频真实宽高比
                   * 反算高度(与之前行为一致)——不需要提前 ffprobe 出镜素材尺寸也能
                   * 等比缩放(不拉伸变形), 等价于旧链 `computePipRect` 按源视频宽
                   * 高比算 rect 高度这一条(`src/lib/video/pip-layout.ts`)。
                   * 'circle'(圆形): 宽高必须相等才能是正圆(borderRadius 50% 套在
                   * 长方形上是椭圆, 不是圆), 所以这里改成宽高相等的正方形——
                   * 代价是视频原始宽高比不是 1:1 时必须裁切(`objectFit: 'cover'`
                   * 而不是 'contain'), 否则圆形容器内会露出黑色的信封边, 观感比
                   * 裁掉画面边缘更差。
                   */
                  height: isCircle ? pipWidth : 'auto',
                  overflow: 'hidden',
                  boxSizing: 'border-box',
                  borderRadius: isCircle ? '50%' : Math.round(pipWidth * PIP_BORDER_RADIUS_RATIO),
                  border: PIP_BORDER,
                  boxShadow: PIP_SHADOW,
                }}
              >
                <OffthreadVideo
                  src={staticFile(sourceVideo!.src)}
                  style={
                    isCircle
                      ? {width: '100%', height: '100%', objectFit: 'cover', display: 'block'}
                      : {width: '100%', height: 'auto', objectFit: 'contain', display: 'block'}
                  }
                />
              </div>
            );
          })()}
        </>
      ) : (
        cardsTrack
      )}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
      {bgm ? <Audio src={staticFile(bgm.src)} loop volume={bgm.volume} /> : null}
      {/* 字幕层必须在最上层——两种版式(cutaway 的窗口内卡片 / pip 的角标)都不能盖住字幕。
          高亮色从 theme.highlight 取(二十九期 Task 5), 不写死: 跟着 visualStyle
          走, card/illustration 两套配色各自的强调色不同。pipReserve 见上方注释,
          非 pip/贴底以外的调用不传, 行为与之前一致。 */}
      <Captions items={captions} highlightColor={theme.highlight} pipReserve={pipReserve} />
    </AbsoluteFill>
  );
};
