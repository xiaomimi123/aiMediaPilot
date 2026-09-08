import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import type { VideoProduction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { clampShotsToSource } from '@/lib/video-production/shot-clamp';
import { ALIGNER } from '@/lib/video-production/aligner-prompt';
import { frameOfAspect } from '@/lib/video-template/aspect';
import {
  buildTtsManifest, durationOfAct, readTtsManifestFile, ttsAudioFilesExist, ttsManifestMatches,
} from '@/lib/video-production/tts-manifest';
import {
  concatAudioTracks,
  extractAudio,
  probeVideoDimensions,
  probeVideoDurationMs,
  probeVideo,
} from '@/lib/video/ffmpeg';
import type { PipPosition } from '@/lib/video/pip-layout';
import { buildSceneComposeArgs } from '@/lib/video/scene-compose';
import type { SceneLayout } from '@/lib/video/scene-layout';
import { execFile } from 'child_process';
import { promisify } from 'util';

/** 逐场景合成直接调 ffmpeg —— 参数由 buildSceneComposeArgs 构造(纯函数, 已测)。 */
const execFileAsyncCompose = (args: string[]) =>
  promisify(execFile)('ffmpeg', args, { timeout: 900_000, maxBuffer: 1 << 26 });
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { buildFactsSection } from '@/lib/video-production/facts-guard';
import { ACT_LABELS, type ActKey } from '@/lib/script/six-act';
import {
  runFreezeDetect, buildFreezeReport, DEFAULT_FREEZE_OPTS, type FreezeReport,
} from '@/lib/video/freeze-check';
import type { ScriptAct } from '@/lib/script/six-act';
import { synthesizeVolcTts } from '@/lib/tts/volcengine';
import { decrypt } from '@/lib/crypto';
import { resolveTtsVoiceSelection, type VoiceSelectable } from '@/lib/video-production/voice-resolve';
import { ttsResultsToAlignedActs, sentenceCaptionEvents, type TtsActResult } from '@/lib/video-production/srt-synthesis';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import { renderFilm, renderShotStill, type CaptionItem, type FilmInput } from '@/lib/video-production/remotion-render';
import { judgeStillPng } from '@/lib/video-production/still-check';
import { isRemotionReadyMode } from '@/lib/video-production/renderer';
import { FilmPlanSchema, describeCardsForPrompt, type FilmPlan } from '@/lib/video-production/shot-plan';
import { actWindows, actWindowsFromAligned, FILM_PLAN, FILM_PLAN_BROLL, type ActWindow } from '@/lib/video-production/film-plan-prompt';
import { buildFilmPlan } from '@/lib/video-production/film-plan-builder';
import { extractOverlayPlan } from '@/lib/video-production/overlay-extraction';
import { timingCheckerFor } from '@/lib/video-production/film-plan-timing';
import { captionEventsFromTranscript, type CaptionEvent } from '@/lib/video-production/caption-events';
import { PIP_SCALE_MIN, PIP_SCALE_MAX } from '@/lib/video/pip-layout';
import {
  runCaptionAlignment,
  buildWordsForEvents,
  parseTimingPayload,
  type CaptionWord,
  type TimingPayload,
} from '@/lib/video-production/align-captions';

/**
 * `recompose`(二十三期): 只重新合成, 不重新生成。
 *
 * 改版面时**绝不能重跑整个预览**: 导演会重新切镜, shotId 全变 —— 刚存的逐场景
 * 版面立刻变成孤儿, 而且白烧几分钟的 LLM 和逐帧截图。改版面只影响合成那一步,
 * 分镜和 B-roll 片段原样复用, 几秒钟就完。
 */
/**
 * `skipPlanGeneration`(三十一期 Task 1): render 路由("确认分镜, 继续渲染")传的标记。
 * 只在 `mode: 'preview'` 时有意义——worker 读到它就跳过 TTS/ASR/对齐/buildFilmPlan/
 * 落库整段, 直接复用上一次已经落盘的 filmPlan/alignedActs 进入渲染段(与三条 handler
 * 各自的 master 分支共用同一条"跳过 AI、复用落库产物"的代码路径, 不第三次复制)。
 * 不传 = 老行为(旧任务/`/start` 路由零迁移)。
 */
type JobData = {
  videoProductionId: string;
  mode: 'preview' | 'master' | 'recompose';
  skipPlanGeneration?: boolean;
};

/** setStatus 的类型：内层各 delivery-mode handler 共用同一个闭包实例，不重复实现落库逻辑。 */
type SetStatusFn = (status: string, extra?: Record<string, unknown>) => Promise<unknown>;

/** 取模板。templateId 为空(内容详情页旧入口)时返回 null, 调用方按默认值走。 */
async function templateOf(templateId: string | null) {
  return templateId ? prisma.videoTemplate.findUnique({ where: { id: templateId } }) : null;
}

function shotDir(productionRoot: string, shotIndex: number): string {
  // shot.shotId 是 LLM 产出的字符串，未做格式约束，不能直接拼进文件路径
  // (可能包含 `..` 等构造出越权写入路径)。目录名固定用数组下标，
  // preview 与 master 两条渲染路径共用同一套下标规则，保证互相能对上。
  return path.join(productionRoot, 'shots', String(shotIndex));
}

/**
 * 常驻框架层(二十四期)要的章节标签: 某个毫秒位置落在 alignedActs(真实对齐后的
 * 六幕边界, {act,startMs,endMs})里的哪一幕, 取不到就不画(不画空标签)。
 *
 * 只给 illustration-tts 用: 它的六幕边界是真实对齐产物, 有精确的 startMs/endMs 可比对。
 * ppt-narration 没有 alignedActs(六幕边界只按 targetSec 累加估出来), 那条链在调用处
 * 直接复用已有的 actAtMs() + ACT_LABELS。
 */
function actLabelFromAlignedActs(acts: AlignedAct[], ms: number): string | null {
  const hit = acts.find((a) => ms >= a.startMs && ms < a.endMs);
  return hit ? ACT_LABELS[hit.act] : null;
}

/** 取该内容的六幕稿; 取不到(旧稿/未生成)时返回空数组, 调用方据此退回原行为。 */
async function loadActs(contentId: string): Promise<ScriptAct[]> {
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  const draft = content?.scriptDraftId
    ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
    : null;
  const parsed = draft ? parseDraftOutput(draft.output) : null;
  return parsed?.acts ?? [];
}

/**
 * 取该内容写稿时采集的素材简报(二十一期 A2)。它是带来源的真实事实点, 是画面最好的
 * 填充料 —— 此前只喂给了写稿, 画面层从来没见过, 于是只能画抽象图形。
 */
async function loadResearch(
  contentId: string,
): Promise<{ points: Array<{ fact: string; source: string; usage?: string }> } | null> {
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  const draft = content?.scriptDraftId
    ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
    : null;
  const parsed = draft ? parseDraftOutput(draft.output) : null;
  return parsed?.research ?? null;
}

/**
 * 图文口播 · Remotion 链(二十五期)。
 *
 * 与旧链的关键差异: **Builder 不写 HTML, 只产 FilmPlan(选卡片 + 填槽)**;
 * 整片一次渲染, 不再有"分镜各渲各的再 concat"这一步。
 */
/**
 * 二十九期 Task 2: ppt-narration 与 illustration-tts 两条 Remotion 分支共用同一套
 * TTS 幂等 + 真实窗口 + FilmPlan + 渲染骨架, 差异只有两处, 参数化成这个 options:
 *
 * - `visualStyle`: 传给 `renderFilm` 的 `FilmInput.visualStyle`(Task 1 新增字段,
 *   渲染层 token 选择) —— 与 `video-template/model.ts` 的模板字段 `visualStyle`
 *   是两个不相干的概念(那个驱动的是旧链 Builder 提示词的风格指引), 这条 Remotion
 *   分支不读模板那个字段, 值由调用方按交付模式写死。
 * - `onMissingTts`: 未配置火山 TTS 时的行为。ppt-narration 无声降级出片(旧行为,
 *   不可改——下面 tests/jobs/video-production-remotion-audio-wiring.test.ts 的源码级
 *   锚点测试盯着); illustration-tts 直接报错, 照抄已删除的旧链同名 handler 的定义与措辞——"插画+配音"没有配音就没有意义, 无声降级那套不该出现
 *   在这条链上。
 *
 * 之所以没有把这段逻辑挪去另一个函数名下、让本函数变成一个三行转发的薄包装:
 * 上述那条源码级锚点测试(以及 video-production-film-plan-wiring.test.ts)靠
 * SRC.indexOf 定位这个函数声明的起止边界来断言分支形状(具体是哪两个字符串见
 * 那两个测试文件本身——这里故意不逐字引用, 避免这条注释自己被 indexOf 命中,
 * 把锚点算错位置)——挪函数名会让那些测试的锚点失效, 而它们守住的行为(是否吞
 * TTS 失败/master 是否重调 LLM/静止体检是否接着等)本身没有变化, 不该因为一次
 * 纯内部重构就要求改测试。函数名保留 ppt-narration 字样是历史包袱, 但函数体
 * 现在是两条链共用的渲染骨架。
 */
type RemotionShotPlanOptions = {
  visualStyle: 'card' | 'illustration';
  onMissingTts: 'degrade-silent' | 'throw';
};

const PPT_NARRATION_REMOTION_OPTIONS: RemotionShotPlanOptions = {
  visualStyle: 'card',
  onMissingTts: 'degrade-silent',
};

/**
 * 导出仅供测试用(三十一期 Task 1, 与 `handleIllustrationTtsRemotion`/
 * `handleTalkingHeadBrollRemotion` 同一先例)——单测要真跑一遍"生成 plan → 因
 * `reviewBeforeRender` 停在 plan_ready"这条路径, 之前只有薄包装
 * `handleIllustrationTtsRemotion` 导出、本体不导出, 但那条链默认无 TTS 配置时
 * 直接抛错(`onMissingTts: 'throw'`), 走不到落库+暂停这一步, 不适合拿来测暂停
 * 逻辑; ppt-narration 无配置时是无声降级(不抛错), 是测这条暂停路径最直接的入口。
 */
export async function handlePptNarrationRemotion(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
  options: RemotionShotPlanOptions = PPT_NARRATION_REMOTION_OPTIONS,
  skipPlanGeneration = false,
): Promise<void> {
  const template = await templateOf(vp.templateId);

  // 状态推进: preview 走 directing(编排分镜, 调 LLM) → building(落库+渲染);
  // master 没有编排这一步(复用 preview 落库的 plan), 直接进 building。
  // 旧渲染层(已删除)也是 directing → building 这个顺序, 这里保持一致,
  // 不要反过来变成 building → directing → building, 否则前端进度条会先跳后退。
  let plan: FilmPlan;
  let captionEvents: CaptionEvent[];
  let audioFile: string | null;
  /**
   * 字级对齐产出的逐词时间戳(二十九期 Task 5), 与 `captionEvents` 同下标对应。
   * `undefined`(整个数组不赋值, 或数组里某一项是 `undefined`) = 这句没有词级
   * 数据, `Captions.tsx` 照旧整句显示——对齐是增强件不是依赖件, 见
   * `align-captions.ts` 顶部注释。
   */
  let wordsPerEvent: Array<CaptionWord[] | undefined> | undefined;
  // `skipPlanGeneration`(三十一期 Task 1): 确认分镜后续跑, 跳过整段生成, 走下面
  // `else` 分支(与 master 复用同一条"读库里已落盘的 filmPlan/alignedActs"路径)。
  if (mode === 'preview' && !skipPlanGeneration) {
    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');

    const acts = await loadActs(vp.contentId);
    if (acts.length === 0) throw new Error('取不到六幕稿, 无法编排画面');

    /*
     * 真实语音时间轴(二十九期): 配了火山 TTS 就逐幕合成人声, 画面窗口与字幕都按
     * 真实时长走(actWindowsFromAligned/sentenceCaptionEvents)——先例见
     * 旧渲染层(已删除)对应逻辑同一先例(TTS 配置读取 + 逐幕合成)。
     * 没配置就退回估算窗口(actWindows)无声出片: 字幕仍然要产, 只是拿估算窗口
     * 构造出与 AlignedAct 同形的数据喂给同一个 sentenceCaptionEvents, 不为无声
     * 路径另写一份比例分配逻辑(那份逻辑已经在 sentenceCaptionEvents 里, 复制一份
     * 迟早会和真实语音那条分叉)。
     */
    const ttsConfig = await prisma.volcTtsConfig.findUnique({ where: { userId: vp.userId } });
    let aligned: AlignedAct[];
    let windows: ActWindow[];
    // 面向用户的降级提醒(二十八期终审): 无声出片此前只 console.warn 到 worker 日志,
    // 界面上完全看不见, 用户点开一条无声成片会以为是 bug。这里同一处判断顺手写一句
    // 用户能看到的话, 而不是只喊给自己听。有声路径显式写 null——覆盖掉上一次(可能
    // 无声)失败重试留下的旧提醒, 不让它继续挂在一条现在已经有声的任务上。
    let productionNotice: string | null;
    if (ttsConfig) {
      const apiKey = decrypt(ttsConfig.apiKey);
      // 音色/资源档位优先级同旧渲染层(已删除): 本次覆盖 > 模板 voicePreset > 全局配置兜底。
      const { voiceType, resourceId } = resolveTtsVoiceSelection({
        voiceOverride: vp.voiceOverride as VoiceSelectable | null,
        templateVoicePreset: (template?.voicePreset as VoiceSelectable | null) ?? null,
        globalConfig: { voiceType: ttsConfig.voiceType, resourceId: ttsConfig.resourceId },
      });

      /*
       * TTS 幂等(二十八期终审): 每次 preview 都无条件逐幕合成会白烧 API 调用。
       * 判断能否复用 —— 逐幕比对 narration 哈希 + voiceType, 都一致才复用 mp3,
       * 任何一幕不一致就整体重合成(理由见 tts-manifest.ts 顶部注释: 部分复用会
       * 把首尾相接的时间轴拼错位)。清单文件缺失/损坏一律当作"不能复用",
       * 不抛错——重新合成本来就是安全路径。
       */
      const manifestPath = path.join(vp.productionRoot, 'tts-manifest.json');
      const existingManifest = await readTtsManifestFile(manifestPath);
      const actsForManifest = acts.map((a) => ({ act: a.act, narration: a.narration }));
      const manifestMatches = ttsManifestMatches(actsForManifest, existingManifest, voiceType);
      // 清单说一致不等于文件真的还在 —— mp3 有可能被手动清理过, 复用前再探一遍。
      const canReuse = manifestMatches && (await ttsAudioFilesExist(vp.productionRoot, acts));

      // 注: 特意不写成一对 if/else 代码块——那个语法形状会撞上本文件另一条源码级锚点
      // 测试(它靠字符串定位 if(ttsConfig) 分支的边界, 多一层同形状的分支会把边界
      // 算错、把复用逻辑误判成"无配置分支")。两个独立的 if 效果等价, 也更不容易和
      // 外层分支边界混淆。
      const ttsResults: TtsActResult[] = [];
      if (canReuse && existingManifest) {
        console.log('[video-production] TTS 音频与稿件一致，复用上次合成结果');
        for (const act of acts) {
          const audioPath = path.join(vp.productionRoot, `tts-${act.act}.mp3`);
          // 时长直接读清单里落盘的值，不重新 ffprobe——文件没变，值也不会变。
          const durationMs = durationOfAct(existingManifest, act.act) ?? 0;
          ttsResults.push({ act: act.act, audioPath, durationMs });
        }
      }
      if (!canReuse || !existingManifest) {
        /*
         * 不变量: **timing.json 的生存期不得长于它对应的 tts-audio.wav**。
         * 复审发现的窄窗口静默错配(2026-09-03): 换音色触发重合成的这一次 preview 里,
         * 若字级对齐恰好失败(venv 缺/超时/崩溃), runCaptionAlignment 返回 null、不写
         * timing.json —— 磁盘上残留的是**旧音色**的对齐结果。它在文本层与新 narration
         * 完全一致, 能骗过 buildWordsForEvents 的全部检查; 用户若不再跑 preview 直接出
         * master, 就是新音频配旧时间戳。与 bundle public 快照是同构的坑(缓存失效条件
         * 与其依赖不对称)。所以判定"需要重新合成"的同时先删旧 timing: 这次对齐成功会写
         * 新的, 失败则 master 干净地退回逐句字幕, 绝不拿旧 timing 配新音频。
         */
        await fs.rm(path.join(vp.productionRoot, 'timing.json'), { force: true });
        for (const act of acts) {
          // 扩展名用 .mp3: synthesizeVolcTts 实际写出的是 mp3 编码字节。
          const audioPath = path.join(vp.productionRoot, `tts-${act.act}.mp3`);
          const { durationMs } = await synthesizeVolcTts(act.narration, audioPath, {
            apiKey,
            voiceType,
            resourceId,
          });
          ttsResults.push({ act: act.act, audioPath, durationMs });
        }
        const durationsMs = Object.fromEntries(ttsResults.map((r) => [r.act, r.durationMs]));
        const manifest = buildTtsManifest(actsForManifest, voiceType, durationsMs);
        await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');
      }
      aligned = ttsResultsToAlignedActs(ttsResults);

      const concatenatedAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');
      // concatAudioTracks 强制重编码为 pcm_s16le 而不是直拼 mp3: mp3 帧编码在拼接点上不是
      // 采样点精确的(实测有几十毫秒漂移 + Non-monotonic DTS 警告), 而 alignedActs 的
      // startMs/endMs 假设了拼接后严丝合缝——直拼会让漂移随幕数增多累积成画面渐进错位。
      // 与旧渲染层(已删除)同一段注释理由完全一致。
      await concatAudioTracks({
        audioPaths: ttsResults.map((r) => r.audioPath),
        outputPath: concatenatedAudioPath,
        concatListPath: path.join(vp.productionRoot, 'concat-audio-list.txt'),
      });
      audioFile = concatenatedAudioPath;
      /*
       * 过滤掉零时长窗口(二十九期终审修复)——`actWindowsFromAligned` 对完全没
       * 讲到的幕产出的是 `startMs === endMs` 这种零长度窗口(见该函数顶部注释),
       * 不是"整条不产生"。这类窗口原样喂给 `FILM_PLAN.buildUserMessage` 会渲染成
       * "5000 ~ 5000 毫秒"这种不可能存在的时间窗噪声句——喂给模型只会诱导它为
       * 一个不存在的时间段硬造一镜, 没有任何信息量。这里在传给 `buildFilmPlan`
       * 之前就地过滤掉, 让提示词只看到真实讲到的幕。
       *
       * `checkFilmPlanTimingWindowed`(`film-plan-timing.ts`)里对零窗口的跳过
       * **依然保留、不删除**——两层过滤各自的职责不同: 这里(worker/生成侧)是
       * 为了不把噪声喂给模型, 属于"优化提示词质量"; 那边(校验侧)是防御纵深,
       * 防的是"万一将来有别的调用路径没经过这层过滤就直接把 windows 传给
       * checkFilmPlanTimingWindowed", 不能假设过滤永远发生在校验之前。
       */
      windows = actWindowsFromAligned(acts, aligned).filter((w) => w.endMs > w.startMs);
      productionNotice = null;
    } else {
      /*
       * illustration-tts 不走无声降级——照抄已删除的旧渲染层同名 handler 的判断
       * 与措辞: 这条交付模式的定义就是"插画+配音", 没有配音就没有存在意义,
       * 不该像 ppt-narration 那样退而求其次出一条无声片。
       */
      if (options.onMissingTts === 'throw') {
        throw new Error('请先在设置页配置火山 TTS');
      }
      console.warn('[video-production] 未配置火山 TTS, 本条为无声出片');
      windows = actWindows(acts);
      aligned = alignedFromWindows(windows);
      audioFile = null;
      productionNotice = '本条为无声成片：未配置火山 TTS。可在设置页配置后重新生成。';
    }
    captionEvents = sentenceCaptionEvents(acts, aligned);

    const totalMs = windows.length > 0 ? windows[windows.length - 1].endMs : 0;

    // `'cards'` 不能省: 默认的 `'freeform'` 会下发旧链的"条目数不少于 8 条",
    // 与 `list` 卡 items 上限 8 自相矛盾, 实测会把模型逼去编条目凑数(见 spec §6½)。
    const research = await loadResearch(vp.contentId);
    const factsSection = buildFactsSection(acts, research, 'cards');

    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const built = await buildFilmPlan({
      llm,
      windows,
      cardsSection: describeCardsForPrompt(),
      factsSection,
      totalMs,
      // 显式传上限(此前没传, 走 API 默认值)。同时给 buildFilmPlan 的截断检测一个
      // 分母——不传就检测不了。8192 远高于实测过的最长产出(27 镜/1890 completionTokens
      // 那次), 留够余量给更长的稿子, 顶到这个数就说明真的被截断了。
      maxTokens: 8192,
    });
    plan = built.plan;
    console.log(`[video-production] FilmPlan 产出完成 (修复 ${built.rounds} 轮, ${plan.shots.length} 镜)`);

    await setStatus('building');

    /*
     * 字级对齐(二十九期 Task 5): 只在真的有配音音频时才跑——没配置 TTS 的
     * 无声出片(audioFile === null)没有语音可对, 谈不上对齐, 直接跳过。
     * 对齐是增强件不是依赖件: `runCaptionAlignment` 内部把 venv 缺失/超时
     * (120s)/崩溃/输出解析失败全部吞掉、`console.warn`, 这里拿到的 timing
     * 可能是 null, `buildWordsForEvents` 对 null 的处理就是整体退回逐句
     * 字幕——不额外加一层 try/catch。
     */
    if (audioFile) {
      const alignStartedAt = Date.now();
      const timing = await runCaptionAlignment({
        audioPath: audioFile,
        events: captionEvents,
        productionRoot: vp.productionRoot,
      });
      const alignMs = Date.now() - alignStartedAt;
      const { wordsPerEvent: aligned2, quality } = buildWordsForEvents(captionEvents, timing);
      wordsPerEvent = aligned2;
      console.log(
        `[video-production] 字级对齐耗时 ${alignMs}ms, 共 ${quality.totalSentences} 句, ` +
          `match<0.90 的句子 ${quality.lowMatchCount} 句${timing ? '' : '(未对齐成功, 已退回逐句字幕)'}`,
      );
      // 质量关(只报不拦): 低质量句子超过三分之一才提醒用户——个别句子对不齐
      // 不影响整体观感, 值不得用户为此重新生成一遍; productionNotice 目前
      // 一定是 null(走到这个分支说明 TTS 成功, 上面没有设过"无声成片"提醒),
      // `??` 只是防御性写法, 不代表真的会有别的值需要保留。
      if (quality.totalSentences > 0 && quality.lowMatchCount / quality.totalSentences > 1 / 3) {
        productionNotice =
          productionNotice ?? '本条字幕对齐质量偏低：个别句子的逐词高亮时间可能不准确。';
      }
    }

    // 落库供 master 复用 —— 与旧链把 Director 结果写进 direction.json 是同一个理由:
    // 正式导出必须和用户看过的预览是同一份画面, 不能重新问一次模型。alignedActs 一并落库:
    // master 靠它复原字幕(sentenceCaptionEvents)和判断 tts-audio.wav 是否该存在。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        filmPlan: plan,
        alignedActs: aligned as unknown as Prisma.InputJsonValue,
        productionNotice,
        updatedAt: new Date().toISOString(),
      },
    });

    /*
     * 生成前剪辑台的暂停点(三十一期 Task 1): TTS/ASR/对齐/FilmPlan 全部已经跑完
     * 并落盘(就在上面这次 update 里), 剩下的只是渲染——`reviewBeforeRender` 开着
     * 时先停在这里等用户逐镜调整方案, 不白白渲一遍用户可能还要改的画面。
     * 用户确认后走 `/render` 路由, 带 `skipPlanGeneration: true` 回来, 命中的是
     * 上面 `if` 的 `!skipPlanGeneration` 条件为 false, 直接进下面的 `else`
     * (复用落盘产物), 不会再问一次模型。
     */
    if (vp.reviewBeforeRender) {
      await setStatus('plan_ready');
      return;
    }
  } else {
    await setStatus('building');
    if (!vp.filmPlan) throw new Error('没有已保存的 FilmPlan, 请先生成预览');
    plan = FilmPlanSchema.parse(vp.filmPlan);

    // master 不重新调 TTS(耗真实调用额度)——复用 preview 落盘的 tts-audio.wav 与已持久化
    // 的 alignedActs, 与旧渲染层(已删除)的 master 分支同一先例。
    if (!vp.alignedActs) throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    const aligned = vp.alignedActs as unknown as AlignedAct[];
    const acts = await loadActs(vp.contentId);
    captionEvents = sentenceCaptionEvents(acts, aligned);

    // preview 当初是有声还是无声(是否配了火山 TTS), 只有 tts-audio.wav 是否落地能回答——
    // 这个文件存在才传 audioFile, 不存在(当初无声出的 preview)就继续无声: master 必须
    // 和用户看过的 preview 保持一致, 不能这时候才悄悄补上人声。
    const ttsAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');
    try {
      await fs.access(ttsAudioPath);
      audioFile = ttsAudioPath;
    } catch {
      audioFile = null;
    }

    // 这个分支不重新跑对齐(耗时的子进程 + ASR 推理, 与不重新调 TTS 同一先例)——
    // 直接复用上一次落盘的 timing.json。文件缺失(比如当初没有 audioFile、或跑在
    // 这个功能上线之前)就整体退回逐句字幕, 不是错误。
    // 走到这里的不只是 master——三十一期 Task 1 起, `skipPlanGeneration` 的
    // preview 确认渲染也复用同一条路径(见函数顶部注释), 日志措辞不再单指 master。
    if (audioFile) {
      let timing: TimingPayload | null = null;
      try {
        timing = parseTimingPayload(await fs.readFile(path.join(vp.productionRoot, 'timing.json'), 'utf-8'));
      } catch {
        timing = null;
      }
      const { wordsPerEvent: aligned2, quality } = buildWordsForEvents(captionEvents, timing);
      wordsPerEvent = aligned2;
      console.log(
        `[video-production] 复用已持久化的对齐结果: 共 ${quality.totalSentences} 句, ` +
          `match<0.90 的句子 ${quality.lowMatchCount} 句${timing ? '' : '(未找到 timing.json, 已退回逐句字幕)'}`,
      );
    }
  }

  const captions: CaptionItem[] = captionEvents.map((e, i) => ({
    text: e.text,
    startMs: e.startMs,
    endMs: e.endMs,
    ...(wordsPerEvent?.[i] ? { words: wordsPerEvent[i] } : {}),
  }));

  const lastMs = Math.max(...plan.shots.map((s) => s.endMs));
  const fps = mode === 'master' ? 30 : 15;
  const aspect = template?.aspect === '9:16' ? '9:16' : '16:9';

  await setStatus('assembling');
  const outputPath = path.join(vp.productionRoot, outputFileName);
  await renderFilm({
    // input.bgm 留 null: bgm 走下面的 bgmFile 参数, 由 renderFilm 自己拷进 remotion/public
    // 并回填 input.bgm(见 remotion-render.ts renderFilm 实现), 这里不用重复填。
    // visualStyle 由 options.visualStyle 决定(二十九期 Task 2)——ppt-narration 传 'card',
    // illustration-tts 传 'illustration', 两条链共用这同一处 renderFilm 调用。
    // sourceVideo 留 null: 出镜视频层接入 worker 是二十九期 Task 4 的范围,
    // 本任务(Task 3)只做 Remotion 侧与 renderFilm 管道——必填字段先显式传 null。
    // templateStyle(三十六期 Task 3): 模板级默认样式, 与逐镜 style 的合并只发生
    // 在 Film.tsx 渲卡处(mergeShotStyle)——这里只透传, `as` 断言理由同 shots。
    input: { shots: plan.shots as any, audioSrc: null, bgm: null, captions, aspect, visualStyle: options.visualStyle, sourceVideo: null, templateStyle: (template?.defaultShotStyle as FilmInput['templateStyle']) ?? undefined },
    outputPath,
    durationInFrames: Math.ceil((lastMs / 1000) * fps),
    fps,
    audioFile,
    bgmFile: template?.bgmPath ? { path: template.bgmPath, volume: template.bgmVolume ?? 0.15 } : null,
  });

  // 静止体检照旧 —— 它读的是成片 mp4, 与渲染器无关(spec §四)
  const freezeReport = await reportFreeze(outputPath, mode);

  // 逐镜画面体检(renderStill 版, 三十期 Task 1)——只报不拦, 见 reportStillHealth 顶部注释。
  await reportStillHealth({
    shots: plan.shots as StillCheckShot[],
    // templateStyle 也要带上(Task 3 盘外补): 体检渲的帧必须和真实出片同一配置,
    // 否则模板默认 scale 改小时, 体检看到的是未缩放的帧, 空白判定跟成片对不上。
    input: { shots: [], audioSrc: null, bgm: null, captions, aspect, visualStyle: options.visualStyle, sourceVideo: null, templateStyle: (template?.defaultShotStyle as FilmInput['templateStyle']) ?? undefined },
    fps,
    workDir: path.join(vp.productionRoot, `still-check-${mode}`),
    kind: mode,
  });

  await setStatus(readyStatus, { [outputField]: outputPath, freezeReport });
}

const ILLUSTRATION_TTS_REMOTION_OPTIONS: RemotionShotPlanOptions = {
  visualStyle: 'illustration',
  onMissingTts: 'throw',
};

/**
 * illustration-tts 交付链的 Remotion 分支(二十九期 Task 2)。薄包装——真正的骨架
 * (TTS 幂等/真实窗口/FilmPlan/渲染/静止体检)在 handlePptNarrationRemotion 里,
 * 这里只是把两处刻意差异(visualStyle='illustration', 未配置 TTS 时报错而不是
 * 无声降级)作为 options 传进去。导出仅供测试用(见
 * tests/jobs/video-production-illustration-tts-remotion.test.ts)。
 */
export async function handleIllustrationTtsRemotion(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
  skipPlanGeneration = false,
): Promise<void> {
  return handlePptNarrationRemotion(
    vp, mode, setStatus, outputFileName, readyStatus, outputField, ILLUSTRATION_TTS_REMOTION_OPTIONS,
    skipPlanGeneration,
  );
}

/**
 * 无 TTS 配置时的降级: 把估算窗口(actWindows)映射成与 AlignedAct 同形的数据,
 * 喂给 sentenceCaptionEvents ——字幕仍然要产, 只是时间轴用估算值, 不为这条
 * 路径另写一份比例分配逻辑(那份逻辑已经在 sentenceCaptionEvents 里)。
 */
function alignedFromWindows(windows: ActWindow[]): AlignedAct[] {
  return windows.map((w) => ({ act: w.act as ActKey, startMs: w.startMs, endMs: w.endMs }));
}

/**
 * 整片静止体检 —— 出片后最后一道关, **只报不拦**。
 *
 * 接这一道的理由: `freeze-check.ts` 写完之后一直没有调用方, 只在我手上跑过一次
 * 一次性脚本。**一个没接进管线的检查等于没有** —— 这个项目里同样的坑栽过一次
 * (并排检测写完不接线, 直到真机出片才发现一直没在跑)。
 *
 * 为什么只警告不拦: 前面四道画面关都是**逐镜**判的, 不合格可以重写那一镜; 静止是
 * **整片**量出来的, 这时候几十镜已经渲完拼好, 拦下来除了让用户白等一次没有别的
 * 用处。真正的修法在渲染那一步(环境运动层), 这里的职责是**在它失效时能被看见**。
 */
/** 导出仅供测试用(见 tests/jobs/video-production-freeze-report.test.ts) —— 这道关只写日志,
 * 不落库也不改状态, 除了真跑一遍拿它的输出之外没有别的观测点。 */
export async function reportFreeze(
  videoPath: string,
  kind: 'preview' | 'master',
): Promise<FreezeReport | null> {
  try {
    const totalMs = await probeVideoDurationMs(videoPath);
    const totalSec = (totalMs ?? 0) / 1000;
    if (totalSec <= 0) return null;
    const segments = await runFreezeDetect(videoPath, DEFAULT_FREEZE_OPTS, undefined, totalSec);
    const report = buildFreezeReport(segments, totalSec, kind, new Date().toISOString());
    if (!report.ok) {
      console.warn(`[video-production] 静止体检不通过 (${videoPath}): ${report.reason}`);
    } else {
      console.log(
        `[video-production] 静止体检通过 (${videoPath}): ` +
        `${report.frozenSec.toFixed(1)}s / ${report.totalSec.toFixed(1)}s`,
      );
    }
    return report;
  } catch (e) {
    // 体检本身炸了不该影响出片 —— 它是观测, 不是产物。返回 null, 界面照实说「没量到」。
    console.warn(`[video-production] 静止体检跑失败 (${videoPath}):`, e);
    return null;
  }
}

type StillCheckShot = { shotId: string; startMs: number; endMs: number };

/**
 * 逐镜画面体检 —— `renderStill` 抽帧版(三十期 Task 1), 只报不拦, 与整片静止体检
 * (`reportFreeze`)同一策略、同一段日志风格。
 *
 * spec §四这条处置表原写的是"空屏/空壳色块判据保留、取帧方式换成 renderStill"——
 * 三十期真机回归推翻了"空壳色块判据保留"这半条: ppt-narration 25/26 镜、
 * illustration 15/16 镜误报, 出镜链 0/20 通过, 人工核实全是正常卡面。根因是
 * `judgeHollowCard`/`judgeFrameDensity` 按"模型自由写 HTML 铺大色块刷分"标定,
 * 与填槽架构(版面由 `remotion/src/cards/*.tsx` 组件保证)错配——大量留白 + 少量
 * 文字是我们自己设计的卡面, 不是空壳。三十一期把这两个判据停用(保留在
 * `still-check.ts` 里不删, 不再被这里调用), 只留"真空屏"判据
 * (`judgeBlankStill`, 见该文件标定注释), 见下方 `judgeStillPng` 调用。
 *
 * **每镜只抽窗口中点一帧**, 不像旧 DOM 探针那样一镜多点取样多数表决 ——
 * `renderStill` 是真渲染, 成本比 Playwright 截图高得多(单帧实测 ~0.6s, 17 镜
 * 约 10s, 结论写在任务报告里); 单帧够用: 空屏这类缺陷在整段时间窗内通常是
 * 持续性的, 不是偶发在某一帧, 中点足够代表整镜。
 *
 * cutaway 版式: 传入的 `shots` 本来就只覆盖"真的有卡片"的时间窗(窗口外是出镜
 * 真人画面, 没有卡片) —— 直接遍历这份数组就是"只查窗口内", 不需要额外过滤。
 * pip 版式同样遍历 `shots`(卡片是主画面, 全程都要检), 两种版式共用同一份实现。
 */
async function reportStillHealth(opts: {
  shots: StillCheckShot[];
  /** 完整 `FilmInput`(除 `shots` 外的字段, 每镜共用) —— 每次抽帧时按 `shots:[shot]`
   * 单独喂给 `renderShotStill`, 见函数体内注释。 */
  input: FilmInput;
  fps: number;
  /** 出镜视频绝对路径(cutaway/pip 用), 其余两条链传 null。 */
  sourceVideoFile?: string | null;
  /** 抽帧 PNG 的落盘目录, 体检完(不论成败)整个删掉——不是持久产物。 */
  workDir: string;
  kind: 'preview' | 'master';
}): Promise<void> {
  if (opts.shots.length === 0) return;
  const { width, height } = frameOfAspect(opts.input.aspect);
  let reportedCount = 0;
  const t0 = Date.now();
  try {
    await fs.mkdir(opts.workDir, { recursive: true });
    for (let i = 0; i < opts.shots.length; i += 1) {
      const shot = opts.shots[i];
      const atMs = Math.round((shot.startMs + shot.endMs) / 2);
      const pngPath = path.join(opts.workDir, `shot-${i}.png`);
      try {
        // 只塞这一镜: Sequence 的 from/durationInFrames 由 shot 自己的
        // startMs/endMs 算出绝对帧号, 不依赖数组里其它镜是否在场。
        const shotInput: FilmInput = { ...opts.input, shots: [shot as unknown] };
        await renderShotStill({
          input: shotInput,
          shotIndex: i,
          atMs,
          outputPath: pngPath,
          fps: opts.fps,
          sourceVideoFile: opts.sourceVideoFile,
        });
        const judgement = await judgeStillPng(pngPath, width, height);
        if (!judgement.ok) {
          reportedCount += 1;
          console.warn(
            `[video-production] 画面体检(renderStill)不通过 [${opts.kind}] 镜 ${shot.shotId}` +
            `(t=${(atMs / 1000).toFixed(1)}s): ${judgement.reason}`,
          );
        }
      } catch (e) {
        // 单镜抽帧/判定失败不该拖垮整条出片流程 —— 这是观测, 不是产物。
        console.warn(`[video-production] 画面体检(renderStill)跑失败 [${opts.kind}] 镜 ${shot.shotId}:`, e);
      } finally {
        await fs.rm(pngPath, { force: true });
      }
    }
  } finally {
    await fs.rm(opts.workDir, { recursive: true, force: true });
  }
  const elapsedMs = Date.now() - t0;
  console.log(
    `[video-production] 画面体检(renderStill)完成 [${opts.kind}]: ${opts.shots.length} 镜, ` +
    `${reportedCount} 镜不通过, 耗时 ${elapsedMs}ms`,
  );
}

/**
 * `talking-head-broll` 交付链的 Remotion 分支(二十九期 Task 4)。
 *
 * **独立写, 不参数化进 `handlePptNarrationRemotion`**——虽然二十九期 Task 2 把
 * `illustration-tts` 做成了共用同一套骨架的 options, 但那两条链(图文口播/插画
 * 配音)本质相同: 都是"无源画面, Director/FilmPlan 凭空排布虚拟时长, 全片由
 * 生成的分镜拼起来"。出镜链完全是另一种结构:
 * - 时间轴锚点来自**真实 ASR 转写 + 语音对齐(ALIGNER)**, 不是 TTS 合成时长;
 * - 音频不走独立人声轨——出镜视频原声直通(`OffthreadVideo` 自带音轨, Task 3
 *   spike 已验证卡片覆盖段人声不断), `renderFilm` 的 `audioFile` 传 `null`;
 * - 成片时长基准是**源视频真实时长**(ffprobe), 不是分镜时间总和——FilmPlan
 *   的 shots 允许留空档(空档=露出出镜画面, 是功能不是缺陷), 不能像
 *   `handlePptNarrationRemotion` 那样用 `Math.max(...shots.endMs)`;
 * - 有 `sourceVideo`(cutaway/pip 版式 + pip 定位)这一层, 另外两条链没有;
 * - 字幕是 ASR 逐句(`captionEventsFromTranscript`), 不是按幕整段铺的
 *   `sentenceCaptionEvents`。
 *
 * 五处差异, 没有一处是"options 传参"能干净表达的开关, 硬塞进
 * `RemotionShotPlanOptions` 只会让那个函数体同时服务两种完全不同的时间轴模型,
 * 可读性反而更差。共用的只有零散的小片段(FilmPlan 修复循环机制、`renderFilm`
 * 调用形状), 这些已经分别抽成 `buildFilmPlan` 的可参数化 prompt/checkTiming
 * 与 `renderFilm` 本身——不需要再抽一层"共享骨架函数"。
 */
export async function handleTalkingHeadBrollRemotion(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
  skipPlanGeneration = false,
): Promise<void> {
  if (!vp.sourceVideoPath) throw new Error('尚未上传出镜视频');
  const sourceVideoPath = vp.sourceVideoPath;

  const template = await templateOf(vp.templateId);
  // 模板可以整个关掉 B-roll(与旧渲染层已删除的同名 handler 同一先例)——关掉时
  // 画面就是原始出镜视频 + 字幕, 跳过整个 FilmPlan 生成(不白烧一次 LLM 调用)。
  const brollOn = template?.brollEnabled ?? true;

  /*
   * layout 选择: template.talkingHeadLayout('cutaway'|'pip')。**提到这里
   * (原先在函数靠后位置计算)是因为二十九期 Task 6 用户验收返工——FilmPlan
   * 生成这一步(下面 `if (brollOn)` 分支)现在要按 layout 分流选提示词/校验
   * (cutaway 用 FILM_PLAN_BROLL/checkBrollPlanTiming 的"不必铺满"语义不变;
   * pip 用 FILM_PLAN/checkFilmPlanTimingWindowed 的"铺满"语义, 见下方分流处
   * 的注释和 `checkFilmPlanTimingWindowed` 顶部注释), 所以要在生成之前就
   * 知道 layout。
   */
  const layout: 'cutaway' | 'pip' = template?.talkingHeadLayout === 'pip' ? 'pip' : 'cutaway';

  let plan: FilmPlan;
  let aligned: AlignedAct[];
  let rawTranscript: TranscriptSegment[];
  // 三十七期: 文字叠加层提取失败不拦片(spec 红线), notice 并进 productionNotice
  // (写法照 handlePptNarrationRemotion 的 productionNotice ?? 拼接惯例)。
  let overlayNotice: string | null = null;
  // `skipPlanGeneration`(三十一期 Task 1): 与 handlePptNarrationRemotion 同一先例,
  // 见该函数内对应注释。
  if (mode === 'preview' && !skipPlanGeneration) {
    // 转写 + 语音对齐(复用现有 directing 状态值, 语义上这里是"转写+对齐",
    // 与旧渲染层(已删除)同一先例)。
    await setStatus('directing');
    const audioPath = path.join(vp.productionRoot, 'source-audio.wav');
    await extractAudio({ videoPath: sourceVideoPath, audioPath });
    const whisper = new LocalWhisperClient();
    const transcription = await whisper.transcribe(audioPath);
    rawTranscript = transcription.segments;

    // 取六幕脚本(与旧渲染层已删除的同名 handler 同一条查找链)
    const content = await prisma.cockpitContent.findUnique({ where: { id: vp.contentId } });
    const draft = content?.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) throw new Error('需要先生成六幕脚本');
    const acts = parsed.acts;

    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const alignLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: alignedResult } = await alignLLM.callStructured({
      systemPrompt: ALIGNER.buildSystemPrompt(),
      userMessage: ALIGNER.buildUserMessage(transcription.segments, acts),
      responseSchema: ALIGNER.responseSchema,
    });
    aligned = alignedResult.acts;

    // 持久化对齐结果: master 渲染直接复用, 不重新做 ASR/对齐这类非确定性 AI 调用
    // (与旧渲染层(已删除)同一先例)。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        alignedActs: aligned as unknown as Prisma.InputJsonValue,
        rawTranscript: rawTranscript as unknown as Prisma.InputJsonValue,
        updatedAt: new Date().toISOString(),
      },
    });

    // 三十七期: 文字叠加层与交付模式正交(与 brollOn 无关), 只由模板开关控制。
    // 提取失败不拦片——`extractOverlayPlan` 两轮修复仍不合格时自己兜底返回
    // `{ items: [] }` + notice, 这里只需要落库, 不用 try/catch。
    if (template?.textOverlayEnabled) {
      const overlayLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
      const { plan: overlayPlan, notice } = await extractOverlayPlan({
        llm: overlayLLM,
        // TranscriptSegment 是秒(startSec/endSec)——OverlayExtractionSchema/
        // archaeology 提示词的时间轴是毫秒, 这里换算。
        segments: rawTranscript.map((s) => ({
          startMs: Math.round(s.startSec * 1000),
          endMs: Math.round(s.endSec * 1000),
          text: s.text,
        })),
        durationMs: (await probeVideoDurationMs(sourceVideoPath)) ?? 0,
      });
      overlayNotice = notice;
      await prisma.videoProduction.update({
        where: { id: vp.id },
        data: {
          overlayPlan: overlayPlan as unknown as Prisma.InputJsonValue,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // FilmPlan 的时间边界: 总时长 = 源视频真实时长(ffprobe), 不是幕窗口总和——
    // 出镜链画面全程有源视频铺底, 卡片只是间歇覆盖, 分镜不需要铺满时间轴。
    const sourceMs = (await probeVideoDurationMs(sourceVideoPath)) ?? 0;

    await setStatus('building');
    if (brollOn) {
      // 过滤零时长窗口——理由与 handlePptNarrationRemotion 那处同一段注释一致
      // (见上方 "过滤掉零时长窗口(二十九期终审修复)"): 不把"没讲到的幕"的
      // 噪声时间窗喂给模型。`checkFilmPlanTimingWindowed` 对零窗口的跳过依然
      // 保留(防御纵深), 这里过滤过的 `windows` 同时也是下面 `checkTiming`
      // 闭包捕获的那份, 校验侧不会再遇到零窗口, 但那层跳过逻辑不因此失去意义。
      const windows = actWindowsFromAligned(acts, aligned).filter((w) => w.endMs > w.startMs);
      // `'cards'` 不能省: 理由同 handlePptNarrationRemotion —— 默认的 'freeform'
      // 会下发旧链"条目数不少于 8 条"那套要求, 与 list 卡 items 上限 8 自相矛盾。
      const research = await loadResearch(vp.contentId);
      const factsSection = buildFactsSection(acts, research, 'cards');
      const filmPlanLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
      const built = await buildFilmPlan({
        llm: filmPlanLLM,
        windows,
        cardsSection: describeCardsForPrompt(),
        factsSection,
        totalMs: sourceMs,
        maxTokens: 8192,
        /*
         * 按 layout 分流提示词/校验(二十九期 Task 6 用户验收返工, 见函数顶部
         * layout 注释)：
         * - `cutaway`: 真人全程铺底、卡片间歇覆盖——空档=露出真人, 是正常功能,
         *   维持 Task 4 定的"不必铺满"语义不变(FILM_PLAN_BROLL/checkBrollPlanTiming)。
         * - `pip`: 真人缩进常驻小窗, 卡片是**主画面**——空档不再是"露出真人"
         *   而是空背景, 等同 ppt-narration/illustration-tts 两条 TTS 链要拦的
         *   黑屏, 复用它们的铺满语义(FILM_PLAN)。但校验不能直接套
         *   `checkFilmPlanTiming`(要求 0~totalMs 一整段无缝, 会被"没讲到的幕
         *   不产生窗口"造成的天然空隙误报, 见该函数与
         *   `checkFilmPlanTimingWindowed` 顶部注释), 改用窗口版
         *   `checkFilmPlanTimingWindowed`——按每一幕自己的时间窗分别校验铺满,
         *   幕间天然空隙不检查。`checkTiming` 的第二个参数(`totalMs`)在这个
         *   闭包里没有用到, 因为窗口本身已经带了每一幕的边界, 用外层
         *   `windows`(闭包捕获)而不是传入的 `totalMs`。
         *
         * 三十一期 Task 2: 这条三元选择抽成了共享函数 `timingCheckerFor`
         * (`film-plan-timing.ts`), 剪辑台的 FilmPlan PUT 路由与这里共用同一份——
         * 选择规则与之前逐字一致, 只是不再各写一份三元判断。
         */
        prompt: layout === 'pip' ? FILM_PLAN : FILM_PLAN_BROLL,
        checkTiming: timingCheckerFor(vp.mode, layout, windows),
      });
      console.log(`[video-production] FilmPlan 产出完成 (修复 ${built.rounds} 轮, ${built.plan.shots.length} 镜)`);

      /*
       * 分镜必须裁回素材长度之内 —— 与旧链 clampShotsToSource 同一先例(真实事故:
       * 素材 155 秒, 分镜排到 234 秒, 尾巴 79 秒既没人声也没台词)。上面的
       * checkBrollPlanTiming 已经在修复循环里拦过"超出源视频时长", 这里的
       * clampShotsToSource 是渲染前的最后一道防线, 双保险不冲突。
       */
      const clampedShots = clampShotsToSource(built.plan.shots, sourceMs);
      if (clampedShots.length !== built.plan.shots.length) {
        console.warn(
          `[video-production] FilmPlan 分镜超出素材长度(${(sourceMs / 1000).toFixed(0)}s), ` +
          `丢掉 ${built.plan.shots.length - clampedShots.length} 个越界镜头`,
        );
      }
      plan = { ...built.plan, shots: clampedShots };
    } else {
      // brollEnabled=false: 跳过整个 FilmPlan 生成——旧链的等价物是"只出人物全屏",
      // 新链等价物是 shots 空数组, 源视频直通 + 字幕。
      // 产品语义待用户确认(终审观察项): layout==='pip' 且 brollEnabled=false 时,
      // shots=[] 意味着卡片轨永远不渲染——pip 版式下主画面本该是"卡片"(见上面
      // layout==='pip' 分支注释里"卡片是主画面"那句), 这个组合下退化成纯色背景
      // +浮窗+字幕, 不崩但"PPT 主画面"这条语义落空了。是否该在这个组合下改走
      // cutaway 语义、或者干脆禁止这个组合, 是产品判断, 本轮不改行为。
      plan = { shots: [] };
    }

    // 落库供 master 复用——与旧链把 direction.json/alignedActs 落盘同一个理由。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        filmPlan: plan,
        updatedAt: new Date().toISOString(),
      },
    });

    // 生成前剪辑台的暂停点(三十一期 Task 1)——理由与 handlePptNarrationRemotion
    // 同一处注释一致: ASR/对齐/FilmPlan 都已落盘, 停的只是渲染。
    if (vp.reviewBeforeRender) {
      await setStatus('plan_ready');
      return;
    }
  } else {
    await setStatus('building');
    if (!vp.filmPlan) throw new Error('没有已保存的 FilmPlan, 请先生成预览');
    /*
     * brollEnabled=false 时 preview 落库的是 `{ shots: [] }`(见上面 preview 分支)——
     * `FilmPlanSchema` 的 `shots` 是 `.min(1)`(图文口播/插画配音那两条链的画面必须
     * 覆盖全片, 空分镜没有意义), 直接拿它 parse 一个空 shots 数组会在 master 复用
     * 时炸掉。出镜链的空分镜是合法状态(画面全程有源视频铺底), 这里先认出这个特例,
     * 不经过严格 schema 就直接采信——反正它本来就是我们自己在 preview 分支写下的,
     * 不是模型的自由产出, 不需要严格校验。
     */
    const rawPlan = vp.filmPlan as { shots?: unknown[] };
    plan = Array.isArray(rawPlan.shots) && rawPlan.shots.length === 0
      ? { shots: [] }
      : FilmPlanSchema.parse(vp.filmPlan);
    if (!vp.alignedActs || !vp.rawTranscript) {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }
    aligned = vp.alignedActs as unknown as AlignedAct[];
    rawTranscript = vp.rawTranscript as unknown as TranscriptSegment[];
  }

  // 字幕: ASR 逐句(captionEventsFromTranscript), 不是按幕整段铺的 sentenceCaptionEvents——
  // 出镜链有真实逐句转写, 没道理退化成整幕粒度。
  //
  // **不接字级对齐(二十九期 Task 5)。** ppt-narration/illustration-tts 两条
  // TTS 链能对齐, 是因为文本是已知的(六幕稿, 逐字确定); 这条出镜链的音频是
  // 真人自由发挥的录音, 没有已知文本可当参照——ASR 转写本身已经是"猜"出来的,
  // 拿转写文本回头去对自己转写出来的语音, 等于自己验自己, 对不齐反而会
  // 制造一份看起来很精确、实际没有验证过的假数据。况且 ASR
  // (`aligner-prompt.ts`)已经给出了逐句真实时间戳, 句级粒度已经够用, 字级
  // 对齐在这条链上收益低、只多一次子进程调用的失败面。`words` 恒为 `undefined`。
  const captions: CaptionItem[] = captionEventsFromTranscript(rawTranscript).map((e) => ({
    text: e.text,
    startMs: e.startMs,
    endMs: e.endMs,
  }));

  // pip 参数从模板三字段取(layout 已在函数靠前处算好, 见上方注释), clamp 语义
  // 搬自旧链 computePipRect(src/lib/video/pip-layout.ts): scale 夹到
  // [PIP_SCALE_MIN, PIP_SCALE_MAX], margin 夹到 >= 0——不搬这一步, 一个越界的模板
  // 配置(比如 scale=1.5)会直接生成一个盖住整个画面的"画中画"(Task 3 复审留的坑)。
  const pip = layout === 'pip'
    ? {
        position: (template?.pipPosition ?? 'br') as PipPosition,
        scale: Math.min(PIP_SCALE_MAX, Math.max(PIP_SCALE_MIN, template?.pipScale ?? 0.25)),
        margin: Math.max(0, Math.round(template?.pipMargin ?? 40)),
        // 形状(二十九期 Task 6 用户验收返工)——模板没有对应字段, 写死
        // 'rounded'(圆角矩形先行, 用户说圆/方都可以)。`Film.tsx` 的 'circle'
        // 分支已经实现好, 等模板加了形状字段, 这里换成读模板配置即可。
        shape: 'rounded' as const,
      }
    : null;

  const aspect = template?.aspect === '9:16' ? '9:16' : '16:9';
  const fps = mode === 'master' ? 30 : 15;
  // 成片时长基准是源视频真实时长, 不是分镜时间总和——出镜链画面全程有源视频铺底,
  // FilmPlan 的 shots 允许留空档, 用 shots 的最大 endMs 会把没有卡片覆盖的尾段切掉。
  const sourceMs = (await probeVideoDurationMs(sourceVideoPath)) ?? 0;

  await setStatus('assembling');
  const outputPath = path.join(vp.productionRoot, outputFileName);
  await renderFilm({
    input: {
      shots: plan.shots as any,
      // 出镜原声直通: 音频不走这个字段(见下方 audioFile: null 的注释), 留 null。
      audioSrc: null,
      bgm: null,
      captions,
      aspect,
      // 出镜链复用 FilmPlan 卡片(与 ppt-narration 同一套卡片组件), 视觉风格固定用
      // 'card'——这条链没有"插画"这个概念, 不读 template.visualStyle(那是旧链
      // Builder 提示词的风格指引, 与这里的 Task 1 渲染层 token 是两个不相干的概念,
      // 见 Task 2 报告里的命名撞车提醒)。
      visualStyle: 'card',
      sourceVideo: { src: '', layout, pip },
      // templateStyle(三十六期 Task 3): 同上一处注释, 只透传, 合并发生在 Film.tsx。
      templateStyle: (template?.defaultShotStyle as FilmInput['templateStyle']) ?? undefined,
    },
    outputPath,
    durationInFrames: Math.ceil((sourceMs / 1000) * fps),
    fps,
    // 出镜原声直通: 出镜视频铺底用 OffthreadVideo, 它自带音轨(Task 3 spike 已验证
    // 卡片覆盖段人声不断)——不需要像 ppt-narration/illustration-tts 那样另外合成/
    // 拼接一条独立人声轨, audioFile 显式传 null。
    audioFile: null,
    bgmFile: template?.bgmPath ? { path: template.bgmPath, volume: template.bgmVolume ?? 0.15 } : null,
    sourceVideoFile: sourceVideoPath,
  });

  const freezeReport = await reportFreeze(outputPath, mode);

  // 逐镜画面体检(renderStill 版, 三十期 Task 1)——只报不拦。cutaway/pip 都遍历
  // 同一份 plan.shots(cutaway 本来就只覆盖有卡片的窗口, pip 全程有卡片), 见
  // reportStillHealth 顶部注释。brollEnabled=false 时 plan.shots=[], 函数内部
  // 直接返回, 不会白跑一次抽帧。
  await reportStillHealth({
    shots: plan.shots as StillCheckShot[],
    input: { shots: [], audioSrc: null, bgm: null, captions, aspect, visualStyle: 'card', sourceVideo: { src: '', layout, pip }, templateStyle: (template?.defaultShotStyle as FilmInput['templateStyle']) ?? undefined },
    fps,
    sourceVideoFile: sourceVideoPath,
    workDir: path.join(vp.productionRoot, `still-check-${mode}`),
    kind: mode,
  });

  // overlayNotice 只在本次跑了提取(preview 且未 skipPlanGeneration)时非空——master
  // 复用 preview 分支不重跑提取, 不传这个键就不会用 null 覆盖掉 preview 已落库的
  // productionNotice(拼接惯例同 handlePptNarrationRemotion)。
  await setStatus(readyStatus, {
    [outputField]: outputPath,
    freezeReport,
    ...(overlayNotice ? { productionNotice: overlayNotice } : {}),
  });
}

async function handleProduce(job: Job<JobData>) {
  const { videoProductionId, mode, skipPlanGeneration } = job.data;

  const setStatus: SetStatusFn = (status, extra = {}) =>
    prisma.videoProduction.update({
      where: { id: videoProductionId },
      data: { status, updatedAt: new Date().toISOString(), ...extra },
    });

  try {
    const vp = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
    if (!vp) throw new Error(`video production ${videoProductionId} not found`);

    const outputFileName = mode === 'master' ? 'master.mp4' : 'preview.mp4';
    const readyStatus = mode === 'master' ? 'done' : 'preview_ready';
    const outputField: 'previewPath' | 'masterPath' = mode === 'master' ? 'masterPath' : 'previewPath';

    if (mode === 'master' && vp.status !== 'approved') {
      throw new Error(`video production ${videoProductionId} 未处于 approved 状态，拒绝正式渲染 (当前: ${vp.status})`);
    }

    // 外层按交付模式(vp.mode，与本函数的 preview/master 渲染档是两个不同概念)分岔，
    // 各交付模式的具体流程封装成独立函数——ppt-narration、talking-head-broll 与
    // illustration-tts 互不干扰，照此形状新增分支不需要改动这两个函数。
    if (mode === 'recompose') {
      /*
       * 只重新合成 —— 分镜和 B-roll 原样复用, 见 handleRecompose 的说明。
       *
       * **有意放在 legacy 拒绝守卫之前**(三十期终审确认): recompose 不走渲染路,
       * 只把当年已经渲好的分镜产物重新拼排版, 它用的合成机制独立于已删的旧渲染层,
       * 对历史 legacy 任务功能完好。「旧渲染已下线」下线的是渲染路, 不是用户对
       * 历史产物的编辑权 —— 拒掉这里是无谓剥夺能力。
       */
      await handleRecompose(vp, setStatus);
      return;
    }

    /*
     * 三十期 Task 3: 旧渲染层(三条旧交付模式 handler、文字叠加层、成片包装段)
     * 已整体删除——三条交付模式均已完成用户验收并全部支持 Remotion(见 renderer.ts
     * REMOTION_READY_MODES), 新建任务默认 renderer='remotion'(defaultRendererForMode)。
     * 历史上 renderer 仍是 'legacy' 的任务(prisma 字段 @default("legacy")，历史数据
     * 不删)如果被重新触发渲染, 在这里直接报错——不是静默失败, 是一句可操作的人话,
     * 写进 errorMessage(见下面 catch 块), 界面上引导用户先把 renderer 切换到 remotion。
     * film-detail.tsx 的切换按钮已相应改为只展示"这条历史任务用旧渲染生成"的说明,
     * 不再提供切回 legacy 的选项(PATCH 路由的 RendererSchema 也已收紧为只接受
     * 'remotion', 拒绝新建/切换到 'legacy')。文字叠加层(textOverlayEnabled)与成片
     * 包装段(BGM 混音/片头片尾)作为产品能力随旧链一起下线, 这两个模板字段在
     * Remotion 渲染下不再生效——见 README。
     */
    if (vp.renderer !== 'remotion') {
      throw new Error('旧渲染已下线，请把这条任务的 renderer 切换到 remotion 后重试');
    }
    if (!isRemotionReadyMode(vp.mode)) {
      throw new Error(`暂不支持的交付模式: ${vp.mode}`);
    }
    if (vp.mode === 'ppt-narration') {
      await handlePptNarrationRemotion(
        vp, mode, setStatus, outputFileName, readyStatus, outputField,
        PPT_NARRATION_REMOTION_OPTIONS, skipPlanGeneration === true,
      );
    } else if (vp.mode === 'illustration-tts') {
      await handleIllustrationTtsRemotion(
        vp, mode, setStatus, outputFileName, readyStatus, outputField, skipPlanGeneration === true,
      );
    } else {
      await handleTalkingHeadBrollRemotion(
        vp, mode, setStatus, outputFileName, readyStatus, outputField, skipPlanGeneration === true,
      );
    }
  } catch (err) {
    await setStatus('failed', { errorMessage: err instanceof Error ? err.message : String(err) });
    throw err; // 让 BullMQ 记一次 failed job，日志可追溯
  }
}

export function startVideoProductionWorker() {
  const worker = new Worker<JobData>(QUEUES.VIDEO_PRODUCTION, handleProduce, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[video-production] failed', job?.id, err);
  });
  worker.on('completed', (job) => {
    console.log('[video-production] completed', job.id);
  });
  return worker;
}

/**
 * 只重新合成(二十三期)。
 *
 * 复用 `direction.json` 和已经渲好的 `shots/N/clip.mp4`, 按当前 `sceneLayouts`
 * 重跑一次合成。**不碰导演、不碰 Builder、不碰 ASR** —— 它们的产物和版面无关,
 * 而重跑它们会让 shotId 变掉、把刚存的版面变成孤儿。
 */
async function handleRecompose(
  vp: {
    id: string; productionRoot: string; sourceVideoPath: string | null;
    sceneLayouts: unknown; templateId: string | null;
  },
  setStatus: SetStatusFn,
): Promise<void> {
  if (!vp.sourceVideoPath) throw new Error('没有出镜视频');
  const sourceVideoPath = vp.sourceVideoPath;

  let direction: { shots: { shotId: string; startMs: number; endMs: number }[] };
  try {
    direction = JSON.parse(await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8'));
  } catch {
    throw new Error('没有分镜, 先跑一次预览');
  }

  await setStatus('assembling');
  const layoutMap = new Map(
    ((vp.sceneLayouts as { shotId?: string; layout?: string }[] | null) ?? []).map(
      (x) => [String(x.shotId ?? ''), String(x.layout ?? '')],
    ),
  );

  const { width, height } = await probeVideoDimensions(sourceVideoPath);
  const { durationSec } = await probeVideo(sourceVideoPath);
  const compositedPath = path.join(vp.productionRoot, 'composited.mp4');

  await execFileAsyncCompose(
    buildSceneComposeArgs({
      sourceVideoPath,
      outputPath: compositedPath,
      frame: { width, height },
      sourceDurationMs: Math.round(durationSec * 1000),
      segments: direction.shots.map((shot, i) => ({
        startMs: shot.startMs,
        endMs: shot.endMs,
        // 片段路径按既有的目录约定重建 —— 它们已经渲好了, 不重渲
        clipPath: path.join(shotDir(vp.productionRoot, i), 'clip.mp4'),
        layout: (layoutMap.get(shot.shotId) ?? 'content-full') as SceneLayout,
      })),
    }),
  );

  const outputPath = path.join(vp.productionRoot, 'preview.mp4');
  await fs.copyFile(compositedPath, outputPath);
  /*
   * 重新合成也要复检。**这一步产出的是一份新成片**, 不复检的话页面上挂的还是上一版
   * 的静止数字 —— 那正是这个项目反复栽的「界面在撒谎」: 数字看着有, 但它描述的那条
   * 片子已经不存在了。真机撞到过: 重新合成跑完, 库里的 freezeReport 还是几小时前
   * 补量那次的 checkedAt。
   */
  const freezeReport = await reportFreeze(outputPath, 'preview');
  await setStatus('preview_ready', { previewPath: outputPath, freezeReport });
}
