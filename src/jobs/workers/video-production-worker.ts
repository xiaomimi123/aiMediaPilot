import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import type { VideoProduction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DIRECTOR, type DirectorResponse } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { ALIGNER } from '@/lib/video-production/aligner-prompt';
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import { buildSrtFromAlignedActs, buildCaptionSrtFromTranscript } from '@/lib/video-production/srt-synthesis';
import {
  concatClips,
  concatAudioTracks,
  extractAudio,
  compositeCutawayVideo,
  burnCaptions,
  probeVideoDimensions,
  probeVideo,
  muxAudioTrack,
  type CutawaySegment,
} from '@/lib/video/ffmpeg';
import type { PipPosition } from '@/lib/video/pip-layout';
import type { PersonSide } from '@/lib/video/text-zone';
import { buildSceneComposeArgs } from '@/lib/video/scene-compose';
import type { SceneLayout } from '@/lib/video/scene-layout';
import { execFile } from 'child_process';
import { promisify } from 'util';

/** 逐场景合成直接调 ffmpeg —— 参数由 buildSceneComposeArgs 构造(纯函数, 已测)。 */
const execFileAsyncCompose = (args: string[]) =>
  promisify(execFile)('ffmpeg', args, { timeout: 900_000, maxBuffer: 1 << 26 });
import { OVERLAY_PLAN, sanitizeOverlayItems } from '@/lib/llm/prompts/overlay-plan';
import {
  buildOverlayAss, REFERENCE_OVERLAY_STYLE, type OverlayItem,
} from '@/lib/video-production/overlay-plan';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { buildFactsSection } from '@/lib/video-production/facts-guard';
import { buildDirectorAssetSection, buildAssignedAssetSection, type ContentAsset } from '@/lib/video-production/asset-manifest';
import { buildStyleSection, buildChapterNavSection, actAtMs } from '@/lib/video-production/style-guard';
import { validateShotHtml } from '@/lib/video-production/shot-html-guard';
import { probeShotHealth } from '@/lib/video-production/shot-renderer';
import { judgeShotDensity } from '@/lib/video-production/frame-density';
import type { ScriptAct } from '@/lib/script/six-act';
import { synthesizeVolcTts } from '@/lib/tts/volcengine';
import { decrypt } from '@/lib/crypto';
import { resolveTtsVoiceSelection, type VoiceSelectable } from '@/lib/video-production/voice-resolve';
import { ttsResultsToAlignedActs, type TtsActResult } from '@/lib/video-production/srt-synthesis';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import type { DeliveryMode } from '@/lib/cockpit/model';
import { runPackaging } from '@/lib/video-production/packaging';
import { buildPackagingOptions } from '@/lib/video-production/packaging-input';

type JobData = { videoProductionId: string; mode: 'preview' | 'master' };

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
 * 调一次 Builder 并体检产物, 不合格就重来一次(二十一期)。
 *
 * 单个分镜的一次生成翻车会让整条任务失败, 而一条片子有十几到几十镜、跑十几分钟——
 * 真实出片五次里踩中两次(漏挂时间线 / 写成自言自语而非代码)。重试一次能把
 * "整条任务失败"降级成"这一镜多花一次调用"。
 * 重试仍失败才抛错, 错误信息带上体检结论, 便于定位是哪一类翻车。
 */
async function buildShotHtmlWithRetry(
  llm: DeepSeekTextLLM,
  systemPrompt: string,
  shot: { shotId: string; startMs: number; endMs: number },
  userMessage: ReturnType<typeof BUILDER.buildUserMessage>,
  probeDir?: string,
): Promise<string> {
  let lastReason = '';
  // 上一轮的诊断结论 —— 下一轮拼进 systemPrompt 喂回给模型。Builder 是盲写的,
  // 不把渲染结果告诉它, 它永远不知道自己排出来是整屏空白(用户点出的本质问题)。
  let feedback = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { result } = await llm.callStructured({
      systemPrompt: systemPrompt + feedback,
      userMessage,
      responseSchema: BUILDER.responseSchema,
    });

    // 第一关: 结构与语法体检(确定性, 不花渲染时间)
    const check = validateShotHtml(result.html);
    if (!check.ok) {
      lastReason = check.reason ?? '未知';
      feedback = `\n\n上一版产出不合格: ${lastReason} 请修正后重写。`;
      console.warn(`[video-production] 镜头 ${shot.shotId} 第 ${attempt} 次产物不合格: ${lastReason}`);
      continue;
    }

    // 第二关: 真渲几帧量画面密度。probeDir 缺省时跳过 —— 让不关心密度的调用方
    // (以及单测)保持原来的行为。
    if (!probeDir) return result.html;

    const health = await probeShotHealth({
      html: result.html,
      durationMs: shot.endMs - shot.startMs,
      workDir: path.join(probeDir, `probe-${attempt}`),
    });

    // 运行时错误优先于密度 —— 页面报错时画面本来就是空的, 报"太空"会指向错的方向。
    // 真实出片踩过 `t.duration is not a function`: 语法对、时间线也挂了, 直到正式
    // 渲染跑完几十镜才炸。体检本来就在真跑页面, 顺手拦下不额外花渲染。
    if (health.runtimeErrors.length > 0) {
      lastReason = `页面运行时报错: ${health.runtimeErrors.slice(0, 2).join(' | ')}`;
      feedback = `\n\n上一版在浏览器里跑不起来: ${lastReason} 请检查 GSAP 用法与选择器是否正确, 重写。`;
      console.warn(`[video-production] 镜头 ${shot.shotId} 第 ${attempt} 次运行时报错: ${lastReason}`);
      continue;
    }

    const density = judgeShotDensity(health.samples);
    if (density.ok) return result.html;

    lastReason = density.reason ?? '画面密度不足';
    feedback = `\n\n上一版渲染出来的实际效果不合格: ${lastReason}`;
    console.warn(`[video-production] 镜头 ${shot.shotId} 第 ${attempt} 次密度不足: ${lastReason}`);
  }

  // 三次都不达标就放行最后一版 —— 密度是质量问题不是可用性问题, 为它废掉整条
  // 任务不划算(结构/语法不合格才是真的不能用, 那条路上面已经 continue 掉了)。
  console.warn(`[video-production] 镜头 ${shot.shotId} 三次仍未达标, 放行最后一版: ${lastReason}`);
  const { result: fallback } = await llm.callStructured({
    systemPrompt: systemPrompt + feedback,
    userMessage,
    responseSchema: BUILDER.responseSchema,
  });
  const finalCheck = validateShotHtml(fallback.html);
  if (!finalCheck.ok) throw new Error(`镜头 ${shot.shotId} 连续多次产出不合格: ${finalCheck.reason}`);
  return fallback.html;
}

/**
 * 取该内容挂的真实素材(二十一期方向 B)。参考视频里密度最高的那几帧靠的就是这类
 * 整块真实截图/表格 —— 纯文字排版结构上达不到那个量级(实测参考自己的纯文字帧也
 * 只有 5% 左右), 所以要有实感只能把真材料喂进去。
 */
async function loadContentAssets(userId: string, contentId: string): Promise<ContentAsset[]> {
  const rows = await prisma.contentAsset.findMany({
    where: { userId, contentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id, kind: r.kind as ContentAsset['kind'], description: r.description,
    fileName: r.fileName, text: r.text,
  }));
}

/**
 * 把图片素材拷进镜头 workDir —— HTML 里用相对路径引用(与 gsap.min.js 同一套路),
 * 写绝对路径换台机器就失效。拷不动的单个文件跳过, 不让一份坏素材废掉整镜。
 */
async function copyAssetsInto(workDir: string, assets: ContentAsset[], contentId: string): Promise<void> {
  const dir = path.join(process.env.CONTENT_ASSET_ROOT || './content-assets', contentId);
  await fs.mkdir(workDir, { recursive: true });
  for (const a of assets) {
    if (a.kind !== 'image' || !a.fileName) continue;
    try {
      await fs.copyFile(path.join(dir, a.fileName), path.join(workDir, a.fileName));
    } catch (e) {
      console.warn(`[video-production] 素材 ${a.fileName} 拷贝失败, 跳过:`, e instanceof Error ? e.message : e);
    }
  }
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

/** 取该内容六幕稿的逐幕台词(act → narration), 供字幕按幕边界铺排; 取不到时返回空表。 */
async function loadNarrations(contentId: string): Promise<Record<string, string>> {
  const acts = await loadActs(contentId);
  return Object.fromEntries(acts.map((a) => [a.act, a.narration]));
}


/**
 * `ppt-narration` 交付模式 (十八期既有行为，原样从 handleProduce 里抽出，零行为改动)。
 * Director 产出的 SRT 驱动分镜, 全部镜头串联成完整片子(无源出镜视频, 无挖空替换)。
 */
/** 导出仅供测试用(见 tests/jobs/video-production-worker-visual-style.test.ts) —— 终审发现2
 * 校验 template.visualStyle 真的接线到了 BUILDER.buildSystemPrompt 调用参数上。 */
export async function handlePptNarration(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  const clipPaths: string[] = [];

  if (mode === 'preview') {
    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    // 二十一期: 六幕稿的 facts 台账下发到画面层, 约束哪些数字允许被具象化(见 facts-guard.ts)。
    // 取不到六幕稿(旧稿)时 factsSection 为空串, prompt 与改动前字符级一致。
    const acts = await loadActs(vp.contentId);
    const factsSection = buildFactsSection(acts, await loadResearch(vp.contentId));
    // 二十一期方向 B: 内容挂的真实素材(截图/表格/长文)。参考视频密度最高的那几帧
    // 靠的就是这类整块真材料, 纯文字排版达不到那个量级。
    const contentAssets = await loadContentAssets(vp.userId, vp.contentId);
    // 导演先看到素材, 主动为它们排镜头并在 assetIds 里指派 —— 第一版只给 Builder,
    // 导演不知情就排不出"展示这张表"的镜头, 实测 4 镜 0 用。
    const directorAssetSection = buildDirectorAssetSection(contentAssets);
    // 二十一期: 模板的风格(亮/暗基调、切镜节奏)要在 Director 阶段就生效——调色板与
    // 分镜时长都是它决定的。所以模板查询提前到 Director 调用之前。
    const template = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    const styleSection = buildStyleSection(
      template
        ? {
            visualTone: (template.visualTone as 'light' | 'dark' | undefined) ?? 'dark',
            shotPaceSec: template.shotPaceSec ?? null,
          }
        : null,
    );
    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await llm.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(factsSection, styleSection, directorAssetSection),
      userMessage: DIRECTOR.buildUserMessage(vp.srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    // 持久化 Director 结果，供后续 approve 之后的 master 渲染复用，
    // 避免正式导出重新调用 DeepSeek 产出和预览不一致的分镜/画面。
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    // 终审发现2: template.visualStyle 此前从未被读到调用点, 用户在模板编辑器改这个下拉会被
    // 静默丢弃。templateId 为空(内容详情页旧入口)时 template 为 null, 落回硬编码默认值 'card'。
    const visualStyle = (template?.visualStyle as 'card' | 'illustration' | undefined) ?? 'card';
    const chapterActs = acts.map((a) => ({ act: a.act, title: a.title }));

    await setStatus('building');
    // 排版吃模型能力: 实测 deepseek-chat 即便有素材+骨架+渲染反馈, 画面密度也只到
    // 5%~8%(参考视频 30%~54%)。模板可以指定更强的模型; 缺省沿用 deepseek-chat。
    const builderModel = (template?.builderModel as 'deepseek-chat' | 'deepseek-reasoner' | undefined) ?? 'deepseek-chat';
    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: builderModel });
    let shotIndex = 0;
    for (const shot of direction.shots) {
      // 章节条要高亮"这一镜讲到哪一幕", 用镜头起点落在哪个幕区间来判定
      // 素材文件要拷进这一镜的 workDir, HTML 才能用相对路径引用
      await copyAssetsInto(shotDir(vp.productionRoot, shotIndex), contentAssets, vp.contentId);
      const navSection = buildChapterNavSection(
        template?.showChapterNav ?? false,
        chapterActs,
        actAtMs(acts, shot.startMs),
      );
      const builtHtml = await buildShotHtmlWithRetry(
        builderLLM,
        BUILDER.buildSystemPrompt(
          direction.palette,
          visualStyle,
          factsSection + buildAssignedAssetSection(contentAssets, shot.assetIds),
          navSection,
        ),
        shot,
        BUILDER.buildUserMessage(shot),
        // 密度体检的临时渲染目录; 只有走模板的任务开这一关(内容详情页旧入口
        // 不传 probeDir, 行为与之前完全一致)
        vp.templateId ? shotDir(vp.productionRoot, shotIndex) : undefined,
      );
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      // 先落盘原始 HTML（与 renderShotToClip 自己写的 workDir/index.html 分开保存），
      // 这样即便这一镜的渲染后续失败，产出的 HTML 依然能保留下来供 master 复用。
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), builtHtml, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: builtHtml,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }
  } else {
    // master 模式：不再调用 Director/Builder，复用 approve 时批准的那份预览产出，
    // 保证正式导出和用户看到并确认的预览在概念/调色/分镜/动画上完全一致。
    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      // master 用独立的 workDir 子目录渲染，天然隔离 frames/index.html，
      // 不会与预览 15fps 跑出来的旧帧混在一起；clip 文件名也不同，不覆盖 clip.mp4。
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }
  }

  await setStatus('assembling');
  const outputPath = path.join(vp.productionRoot, outputFileName);
  await concatClips({
    clipPaths,
    outputPath,
    concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
  });

  await setStatus(readyStatus, { [outputField]: outputPath });
}

/**
 * `talking-head-broll` 交付模式 (十九期新增) —— 真人出镜视频 + AI 生成的 B-roll
 * 挖空替换 + 真实字幕烧录。与 ppt-narration 的关键差异：
 * - 时间轴锚点来自真实 ASR 转写 + 语音对齐(ALIGNER)，不是 Director 凭空排布的虚拟时长；
 * - 最终产物是"挖空替换"(compositeCutawayVideo)+"字幕烧录"(burnCaptions)两步合成，
 *   不是纯 AI 分镜片段直接拼接(concatClips)。
 */
/** 导出仅供测试用(见 tests/jobs/video-production-worker-wrap-fixes.test.ts) —— 终审发现1
 * (模板配了 captionStyle 时跳过默认 .srt 烧录) 与发现2 (visualStyle 接线) 的回归测试。 */
export async function handleTalkingHeadBroll(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  if (!vp.sourceVideoPath) throw new Error('尚未上传出镜视频');
  const sourceVideoPath = vp.sourceVideoPath;

  if (mode === 'preview') {
    // 转写 + 语音对齐 (复用现有 directing 状态值，语义上这里是"转写+对齐")
    await setStatus('directing');
    const audioPath = path.join(vp.productionRoot, 'source-audio.wav');
    await extractAudio({ videoPath: sourceVideoPath, audioPath });
    const whisper = new LocalWhisperClient();
    const transcription = await whisper.transcribe(audioPath);

    // 取六幕脚本 (同 POST /api/v1/cockpit/video-productions 的 route.ts 用的同一条查找链)
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
    const { result: aligned } = await alignLLM.callStructured({
      systemPrompt: ALIGNER.buildSystemPrompt(),
      userMessage: ALIGNER.buildUserMessage(transcription.segments, acts),
      responseSchema: ALIGNER.responseSchema,
    });
    // 持久化对齐结果：master 渲染直接复用，不重新做 ASR/对齐这类非确定性 AI 调用。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        alignedActs: aligned.acts as unknown as Prisma.InputJsonValue,
        rawTranscript: transcription.segments as unknown as Prisma.InputJsonValue,
        updatedAt: new Date().toISOString(),
      },
    });

    const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
    const srt = buildSrtFromAlignedActs(aligned.acts, narrations);

    await setStatus('building');
    // 二十一期: acts 已在上方取到, 直接派生画面层的事实护栏(见 facts-guard.ts)。
    const factsSection = buildFactsSection(acts, await loadResearch(vp.contentId));
    const directorLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await directorLLM.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(factsSection),
      userMessage: DIRECTOR.buildUserMessage(srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    // 终审发现2: template.visualStyle 此前从未被读到调用点。
    const visualStyleTemplate = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    const visualStyle = (visualStyleTemplate?.visualStyle as 'card' | 'illustration' | undefined) ?? 'card';

    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const cutawaySegments: CutawaySegment[] = [];
    let shotIndex = 0;
    /*
     * 模板可以整个关掉 B-roll(二十三期)。关掉之后画面就是原始出镜视频, 视觉全靠
     * 文字叠加层 —— 拆参考片的结论是真实口播视频本来就是这样。
     *
     * 关掉时**跳过整个 Builder + 渲染循环**, 不是生成了再丢: 那一圈是这条管线里
     * 最贵的部分(每镜一次 LLM + 一次无头浏览器逐帧截图)。
     */
    const brollOn = (await templateOf(vp.templateId))?.brollEnabled ?? true;
    for (const shot of brollOn ? direction.shots : []) {
      const builtHtml = await buildShotHtmlWithRetry(
        builderLLM,
        BUILDER.buildSystemPrompt(direction.palette, visualStyle, factsSection),
        shot,
        BUILDER.buildUserMessage(shot),
      );
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), builtHtml, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: builtHtml,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps，与 ppt-narration 分支一致
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      cutawaySegments.push({ startMs: shot.startMs, endMs: shot.endMs, clipPath });
      shotIndex += 1;
    }

    await setStatus('assembling');
    const compositedPath = path.join(vp.productionRoot, 'composited.mp4');
    // 画中画由模板配置驱动。cutaway(默认)时不传 pip, 走原来的顺序挖空。
    const layoutTemplate = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    const pip =
      layoutTemplate?.talkingHeadLayout === 'pip'
        ? {
            position: (layoutTemplate.pipPosition ?? 'br') as PipPosition,
            scale: layoutTemplate.pipScale ?? 0.25,
            margin: layoutTemplate.pipMargin ?? 40,
          }
        : undefined;
    /*
     * 逐场景版面(二十三期)。production 上存了 sceneLayouts 就走新的合成器
     * (支持人物全屏/分屏/圆窗), 没存就走原来的顺序挖空 —— 已有任务零迁移。
     *
     * 这一步之前是个「界面在撒谎」的口子: 编辑台里能选分屏和圆窗、也能预览,
     * 但出片时根本没实现, 成片和编辑台对不上。
     */
    const refreshedLayouts = vp.sceneLayouts as unknown[] | null;
    const layoutMap = new Map(
      (Array.isArray(refreshedLayouts) ? refreshedLayouts : []).map(
        (x) => [String((x as { shotId?: string }).shotId ?? ''), String((x as { layout?: string }).layout ?? '')],
      ),
    );
    if (layoutMap.size > 0) {
      const { width, height } = await probeVideoDimensions(sourceVideoPath);
      const { durationSec } = await probeVideo(sourceVideoPath);
      await execFileAsyncCompose(
        buildSceneComposeArgs({
          sourceVideoPath,
          outputPath: compositedPath,
          frame: { width, height },
          sourceDurationMs: Math.round(durationSec * 1000),
          segments: direction.shots.map((shot, i) => ({
            startMs: shot.startMs,
            endMs: shot.endMs,
            clipPath: cutawaySegments[i]?.clipPath,
            layout: (layoutMap.get(shot.shotId) ?? 'content-full') as SceneLayout,
          })),
        }),
      );
    } else {
      await compositeCutawayVideo({ sourceVideoPath, segments: cutawaySegments, outputPath: compositedPath, pip });
    }
    const outputPath = path.join(vp.productionRoot, outputFileName);
    const captionTemplate = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    if (captionTemplate?.captionStyle) {
      // 终审发现1(spec §3.2 去重规则): 模板配了 captionStyle 时, 默认 .srt 烧录整段跳过,
      // 交给成片包装段(runPackaging, 见 handleProduce)统一烧 .ass, 避免两层字幕叠在一起。
      // 预览档不跑包装段(spec §3.1: 预览审内容不包装), 所以这里预览产物就是"裸画面,
      // 无字幕"——这是设计取舍, 不是遗漏: 预览审的是分镜与内容, 字幕样式要等 master
      // 包装段才最终呈现。不要因为预览没字幕就把这段烧录加回来。
      await fs.copyFile(compositedPath, outputPath);
    } else {
      const captionSrt = buildCaptionSrtFromTranscript(transcription.segments);
      await burnCaptions({ videoPath: compositedPath, srt: captionSrt, outputPath });
    }

    await setStatus(readyStatus, { [outputField]: outputPath });
  } else {
    // master 模式：复用持久化的 direction.json/source.html + 已对齐的 alignedActs/rawTranscript，
    // 不重新做 ASR/对齐这类耗时且非确定性的 AI 调用 —— 与 ppt-narration master 分支同一先例。
    if (!vp.alignedActs || !vp.rawTranscript) {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }
    const rawTranscript = vp.rawTranscript as unknown as TranscriptSegment[];

    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    const cutawaySegments: CutawaySegment[] = [];
    let shotIndex = 0;
    // 同预览分支: 模板关掉 B-roll 时整个循环跳过, 画面就是原始出镜视频
    const brollOnMaster = (await templateOf(vp.templateId))?.brollEnabled ?? true;
    for (const shot of brollOnMaster ? direction.shots : []) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps，与 ppt-narration 分支一致
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      cutawaySegments.push({ startMs: shot.startMs, endMs: shot.endMs, clipPath });
      shotIndex += 1;
    }

    await setStatus('assembling');
    // 用独立文件名，与预览档的 composited.mp4 分开，避免 approve→master 渲染中途覆盖预览产物。
    const compositedPath = path.join(vp.productionRoot, 'composited-master.mp4');
    // 画中画由模板配置驱动。cutaway(默认)时不传 pip, 走原来的顺序挖空。
    const layoutTemplate = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    const pip =
      layoutTemplate?.talkingHeadLayout === 'pip'
        ? {
            position: (layoutTemplate.pipPosition ?? 'br') as PipPosition,
            scale: layoutTemplate.pipScale ?? 0.25,
            margin: layoutTemplate.pipMargin ?? 40,
          }
        : undefined;
    /*
     * 逐场景版面(二十三期)。production 上存了 sceneLayouts 就走新的合成器
     * (支持人物全屏/分屏/圆窗), 没存就走原来的顺序挖空 —— 已有任务零迁移。
     *
     * 这一步之前是个「界面在撒谎」的口子: 编辑台里能选分屏和圆窗、也能预览,
     * 但出片时根本没实现, 成片和编辑台对不上。
     */
    const refreshedLayouts = vp.sceneLayouts as unknown[] | null;
    const layoutMap = new Map(
      (Array.isArray(refreshedLayouts) ? refreshedLayouts : []).map(
        (x) => [String((x as { shotId?: string }).shotId ?? ''), String((x as { layout?: string }).layout ?? '')],
      ),
    );
    if (layoutMap.size > 0) {
      const { width, height } = await probeVideoDimensions(sourceVideoPath);
      const { durationSec } = await probeVideo(sourceVideoPath);
      await execFileAsyncCompose(
        buildSceneComposeArgs({
          sourceVideoPath,
          outputPath: compositedPath,
          frame: { width, height },
          sourceDurationMs: Math.round(durationSec * 1000),
          segments: direction.shots.map((shot, i) => ({
            startMs: shot.startMs,
            endMs: shot.endMs,
            clipPath: cutawaySegments[i]?.clipPath,
            layout: (layoutMap.get(shot.shotId) ?? 'content-full') as SceneLayout,
          })),
        }),
      );
    } else {
      await compositeCutawayVideo({ sourceVideoPath, segments: cutawaySegments, outputPath: compositedPath, pip });
    }
    const outputPath = path.join(vp.productionRoot, outputFileName);
    const captionTemplate = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    if (captionTemplate?.captionStyle) {
      // 同预览分支(终审发现1): 交给包装段统一烧 .ass, 这里只原样搬运合成结果, 保证
      // master 与 preview 观感一致(两个分支都要改, 否则用户预览看到的字幕样式和最终
      // 成片对不上)。
      await fs.copyFile(compositedPath, outputPath);
    } else {
      const captionSrt = buildCaptionSrtFromTranscript(rawTranscript);
      await burnCaptions({ videoPath: compositedPath, srt: captionSrt, outputPath });
    }

    await setStatus(readyStatus, { [outputField]: outputPath });
  }
}

/**
 * `illustration-tts` 交付模式 (十九期新增) —— 无出镜视频, 用火山引擎 TTS 逐幕合成配音,
 * 驱动纯 AI 插画分镜(BUILDER visualStyle='illustration')直接拼接。与另外两个分支的关键差异：
 * - 没有真人出镜视频/ASR，时间轴锚点来自 TTS 逐幕合成的真实音频时长(ttsResultsToAlignedActs)；
 * - 最终产物是"画面拼接(concatClips)+ TTS 配音轨拼接 + 混流(muxAudioTrack)"，
 *   不是 compositeCutawayVideo 那种挖空替换。
 */
/** 导出仅供测试用(见 tests/jobs/video-production-worker.test.ts) —— 校验缺口1 的音色优先级链
 * 真的接线到了 TTS 调用参数上, 且 apiKey 始终来自全局配置、不受模板/覆盖影响。 */
export async function handleIllustrationTts(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  if (mode === 'preview') {
    // TTS 逐幕配音 (复用现有 directing 状态值，语义上这里是"TTS 配音")
    await setStatus('directing');

    // 取六幕脚本 (同 handleTalkingHeadBroll 用的同一条查找链)
    const content = await prisma.cockpitContent.findUnique({ where: { id: vp.contentId } });
    const draft = content?.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) throw new Error('需要先生成六幕脚本');
    const acts = parsed.acts;

    const ttsConfig = await prisma.volcTtsConfig.findUnique({ where: { userId: vp.userId } });
    if (!ttsConfig) throw new Error('请先在设置页配置火山 TTS');
    const apiKey = decrypt(ttsConfig.apiKey);

    // 音色/资源档位优先级(task-10b 缺口1): 本次任务的临时覆盖 > 模板 voicePreset > 全局配置兜底。
    // apiKey 不参与这条链——它是账号级密钥, 上面已经直接从全局 ttsConfig 取好, 不受模板/覆盖影响。
    // templateId 为空(内容详情页旧入口)时 template 为 null, 优先级链自然落到全局配置, 零迁移。
    const template = vp.templateId
      ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
      : null;
    const { voiceType, resourceId } = resolveTtsVoiceSelection({
      voiceOverride: vp.voiceOverride as VoiceSelectable | null,
      templateVoicePreset: (template?.voicePreset as VoiceSelectable | null) ?? null,
      globalConfig: { voiceType: ttsConfig.voiceType, resourceId: ttsConfig.resourceId },
    });

    const ttsResults: TtsActResult[] = [];
    for (const act of acts) {
      // 扩展名用 .mp3：synthesizeVolcTts 实际写出的是 mp3 编码字节(audio_params.format:'mp3')，
      // 用 .wav 会误导直接翻 productionRoot 目录的人。
      const audioPath = path.join(vp.productionRoot, `tts-${act.act}.mp3`);
      const { durationMs } = await synthesizeVolcTts(act.narration, audioPath, {
        apiKey,
        voiceType,
        resourceId,
      });
      ttsResults.push({ act: act.act, audioPath, durationMs });
    }
    const alignedActs = ttsResultsToAlignedActs(ttsResults);
    // 持久化对齐结果：master 渲染直接复用，不重新调用 TTS(耗真实调用额度)。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        alignedActs: alignedActs as unknown as Prisma.InputJsonValue,
        updatedAt: new Date().toISOString(),
      },
    });

    const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
    const srt = buildSrtFromAlignedActs(alignedActs, narrations);

    await setStatus('building');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    // 二十一期: acts 已在上方取到, 直接派生画面层的事实护栏(见 facts-guard.ts)。
    const factsSection = buildFactsSection(acts, await loadResearch(vp.contentId));
    const directorLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await directorLLM.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(factsSection),
      userMessage: DIRECTOR.buildUserMessage(srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    // 终审发现2: template.visualStyle 此前从未被读到调用点, 一直硬编码 'illustration'——
    // 复用上面(音色优先级链)已经取过的同一个 template, 不重复查询。
    const visualStyle = (template?.visualStyle as 'card' | 'illustration' | undefined) ?? 'illustration';

    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const clipPaths: string[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const builtHtml = await buildShotHtmlWithRetry(
        builderLLM,
        BUILDER.buildSystemPrompt(direction.palette, visualStyle, factsSection),
        shot,
        BUILDER.buildUserMessage(shot),
      );
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), builtHtml, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: builtHtml,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps，与另外两个分支一致
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }

    await setStatus('assembling');
    const videoOnlyPath = path.join(vp.productionRoot, 'video-only.mp4');
    await concatClips({
      clipPaths,
      outputPath: videoOnlyPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
    });
    // 音频轨拼接：ttsResults 天然按六幕固定顺序排列，与合成 alignedActs 的顺序一致。
    // 注意不能复用 concatClips —— 它对视频用 `-c copy` 纯字节拼接，视频分镜是同一渲染器
    // 产出、编码参数严格一致，字节拼接安全；但 mp3 这类帧编码音频用 -c copy 在拼接点上
    // 不是采样点精确的(实测会有几十毫秒漂移 + Non-monotonic DTS 警告)，而 alignedActs 的
    // 每幕 startMs/endMs 是按 ffprobe 出来的单幕时长累加算出的，假设了拼接后严丝合缝——
    // 漂移会让实际音轨边界和这个假设对不上，随幕数增多累积成画面渐进错位。
    // concatAudioTracks 用同一份 concat demuxer 技巧但强制重编码为 pcm_s16le，规避这个问题。
    const concatenatedAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');
    await concatAudioTracks({
      audioPaths: ttsResults.map((r) => r.audioPath),
      outputPath: concatenatedAudioPath,
      concatListPath: path.join(vp.productionRoot, 'concat-audio-list.txt'),
    });

    const outputPath = path.join(vp.productionRoot, outputFileName);
    await muxAudioTrack({ videoPath: videoOnlyPath, audioPath: concatenatedAudioPath, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  } else {
    // master 模式：复用持久化的 direction.json/source.html + 已合成的 alignedActs/per-act TTS 音频，
    // 不重新调用 TTS(真实调用额度)/DeepSeek —— 与另外两个分支 master 分支同一先例。
    if (!vp.alignedActs) {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }
    const alignedActs = vp.alignedActs as unknown as AlignedAct[];

    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    const clipPaths: string[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps，与另外两个分支一致
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }

    await setStatus('assembling');
    // 用独立文件名，与预览档的 video-only.mp4 分开，避免 approve→master 渲染中途覆盖预览产物。
    const videoOnlyPath = path.join(vp.productionRoot, 'video-only-master.mp4');
    await concatClips({
      clipPaths,
      outputPath: videoOnlyPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list-master.txt'),
    });
    // 复用预览阶段已经拼接好的完整 TTS 音轨(tts-audio.wav，重编码 pcm 后的产物)，音频时长与
    // 画面 fps 无关，不需要因为画面重渲染为 30fps 就重新合成/重新拼接语音——按 alignedActs 里
    // 持久化的顺序(startMs 升序，等同预览阶段合成 ttsResults 时的六幕固定顺序)找回各幕原始
    // mp3 文件仅用于校验其仍然存在；真正参与混流的是预览阶段已拼好的那条完整音轨。
    const orderedActs = [...alignedActs].sort((a, b) => a.startMs - b.startMs);
    for (const a of orderedActs) {
      const perActPath = path.join(vp.productionRoot, `tts-${a.act}.mp3`);
      try {
        await fs.access(perActPath);
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (缺少 ${a.act} 幕配音)`);
      }
    }
    const concatenatedAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');

    const outputPath = path.join(vp.productionRoot, outputFileName);
    await muxAudioTrack({ videoPath: videoOnlyPath, audioPath: concatenatedAudioPath, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  }
}

async function handleProduce(job: Job<JobData>) {
  const { videoProductionId, mode } = job.data;

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
    // illustration-tts(十九期新增)互不干扰，照此形状新增分支不需要改动这两个函数。
    if (vp.mode === 'talking-head-broll') {
      await handleTalkingHeadBroll(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else if (vp.mode === 'ppt-narration') {
      await handlePptNarration(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else if (vp.mode === 'illustration-tts') {
      await handleIllustrationTts(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else {
      throw new Error(`暂不支持的交付模式: ${vp.mode}`);
    }

    /*
     * 二十三期: 文字叠加层 —— **和交付模式正交**, 三种模式跑完都能加。
     *
     * 放在包装段之前: 包装段要烧字幕、混 BGM、接片头片尾, 而叠加是画面内容的
     * 一部分, 必须先进画面再被包装。顺序反了的话片头片尾上也会盖上关键词。
     *
     * 失败不影响已经产出的画面 —— 叠加是加分项, 不该让一条渲染好的片子作废。
     */
    {
      const t = vp.templateId
        ? await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } })
        : null;
      if (t?.textOverlayEnabled) {
        const refreshed = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
        const basePath = refreshed?.[outputField];
        if (basePath) {
          try {
            const withText = path.join(vp.productionRoot, `overlay-${outputFileName}`);
            const r = await applyTextOverlay({
              userId: vp.userId,
              videoPath: basePath,
              outputPath: withText,
              productionRoot: vp.productionRoot,
              template: t,
              setStatus,
            });
            if (r) {
              await setStatus(readyStatus, { [outputField]: withText, alignedActs: r.items });
            }
          } catch (e) {
            console.error('[text-overlay]', e);
          }
        }
      }
    }

    // 二十期: 成片包装段 —— 三交付模式共用, 只在 master 渲染完成后执行(预览审内容, 不包装)。
    // templateId 为空(内容详情页旧入口)时整段跳过, 行为与十九期字符级一致(零迁移)。
    if (mode === 'master' && vp.templateId) {
      const template = await prisma.videoTemplate.findUnique({ where: { id: vp.templateId } });
      const refreshed = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
      const masterPath = refreshed?.masterPath;
      if (template && masterPath) {
        await setStatus('packaging');
        const narrations = await loadNarrations(vp.contentId);
        const packagedPath = path.join(vp.productionRoot, 'packaged.mp4');
        await runPackaging({
          masterPath,
          workDir: vp.productionRoot,
          outputPath: packagedPath,
          options: buildPackagingOptions({
            template,
            mode: vp.mode as DeliveryMode,
            transcript: (refreshed?.rawTranscript as unknown as TranscriptSegment[] | null) ?? null,
            alignedActs: (refreshed?.alignedActs as unknown as AlignedAct[] | null) ?? null,
            narrations,
            srt: vp.srt,
          }),
        });
        // 包装后的成片取代原 masterPath 作为交付物; 未包装的 master.mp4 保留在
        // productionRoot 里(包装若失败也有东西可下, spec §3.1)。
        await setStatus('done', { masterPath: packagedPath });
      }
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
 * 文字叠加层(二十三期)。
 *
 * **和交付模式正交** —— 图文口播、真人出镜、插画配音跑完之后都能加这一层。
 * 第一版把它做成了第四种交付模式, 那是层级错误: 它只是口播视频的一种形式,
 * 而真人形象将来要能加到任何模式上。
 *
 * 参考片拆解见 `docs/superpowers/specs/2026-08-29-talking-head-overlay-style.md`:
 * 真实的口播视频不切镜, 所有视觉都是叠在真人画面上的文字。所以这一层不需要
 * Builder、不需要 Chromium —— 编译成一个 `.ass` 一次烧完。
 *
 * **文字落位由安全区算, 不写死。** 安全区来自画幅 + 版面 + 人在哪一侧:
 * 横屏人在右 → 左半边; 竖屏 → 上方一条带(人脸占中间, 左右都贴脸)。
 */
async function applyTextOverlay(input: {
  userId: string;
  videoPath: string;
  outputPath: string;
  productionRoot: string;
  template: { personSide: string | null; description: string | null } | null;
  setStatus: SetStatusFn;
}): Promise<{ items: OverlayItem[] } | null> {
  const { userId, videoPath, outputPath, productionRoot, template, setStatus } = input;

  await setStatus('building');
  const audioPath = path.join(productionRoot, 'overlay-audio.wav');
  await extractAudio({ videoPath, audioPath });
  const transcription = await new LocalWhisperClient().transcribe(audioPath);
  await fs.unlink(audioPath).catch(() => {});

  const segments = transcription.segments
    .map((s) => ({
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
      text: s.text.trim(),
    }))
    .filter((s) => s.text.length > 0);
  // 没有人声就没有可叠的东西 —— 直接跳过整层, 而不是叠一堆编出来的词
  if (segments.length === 0) return null;

  const durationMs = Math.round(transcription.durationSec * 1000);
  const deepseekKey = await resolveDeepSeekApiKey(userId);
  if (!deepseekKey) throw new Error('未配置 DeepSeek key');

  const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
  const { result } = await llm.callStructured({
    systemPrompt: OVERLAY_PLAN.buildSystemPrompt(),
    userMessage: OVERLAY_PLAN.buildUserMessage({ segments, durationMs }),
    responseSchema: OVERLAY_PLAN.responseSchema,
  });

  const items = sanitizeOverlayItems(
    result.items,
    durationMs,
    segments.map((s) => s.text),
  ) as OverlayItem[];
  if (items.length === 0) return null;

  // 尺寸必须探真的: 传错时 libass 会静默把整层拉伸, 字号和位置一起歪
  const frame = await probeVideoDimensions(videoPath);
  const disclaimer = String(template?.description ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const ass = buildOverlayAss(items, REFERENCE_OVERLAY_STYLE, frame, {
    disclaimer: disclaimer.length > 0 ? disclaimer : undefined,
    durationMs,
    personSide: (template?.personSide ?? 'right') as PersonSide,
  });
  await fs.writeFile(path.join(productionRoot, 'overlay.ass'), ass, 'utf-8');

  await burnCaptions({ videoPath, srt: ass, outputPath, format: 'ass' });
  return { items };
}
