import fs from 'node:fs/promises';
import path from 'node:path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { buildOverlayArrangement, type TranscriptLine } from '@/lib/overlay-studio/arrange';
import { ensureStudioRunning, runOverlayLint, studioAvailable, studioDir } from '@/lib/overlay-studio/studio';
import { probeVideoDurationMs } from '@/lib/video/ffmpeg';

/**
 * 「特效编辑台」一键准备(2026-09-20, Overlay Studio 集成)。
 *
 * 出镜片的特效层改走外部工具 Overlay Studio(评估记录见 memory / README):
 * 本路由把一条出镜任务的素材备成它要的三件套 —— SRT(取库里**校对过的**
 * rawTranscript, 不重新转写)、编排 JSON(DeepSeek 按压缩版编排规则生成,
 * 结构校验 + Studio lint 双重把关的修复循环)、STATUS.md —— 落在
 * productionRoot/overlay-studio/ 下, 并确保 Studio dev server 在跑。
 *
 * 之后的微调/导出发生在 Studio 里(它的职责), 导出的透明 MOV 用户在剪映里
 * 与原片合成 —— 原片一帧不压, 这正是弃用自建烧录式叠字的理由。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);
  if (vp.mode !== 'talking-head-broll') return fail('特效编辑台只服务真人出镜片 —— 卡片链的画面本来就是合成的, 不走叠加层', 400);
  if (!vp.sourceVideoPath) return fail('还没上传出镜视频 —— 先上传, 转写完成后再来', 400);
  if (!vp.rawTranscript) return fail('还没有转写(rawTranscript 为空) —— 先跑一次预览生成, 转写与校对会落库', 400);
  if (!studioAvailable()) return fail(`Overlay Studio 不在 ${studioDir()} —— 见 README「对话式出片」一节的安装说明`, 500);

  const segments = (vp.rawTranscript as unknown as TranscriptLine[])
    .filter((s) => typeof s?.startSec === 'number' && typeof s?.text === 'string');
  if (segments.length === 0) return fail('rawTranscript 形状不对, 一条可用字幕都没解出来', 500);

  const durationSec = ((await probeVideoDurationMs(vp.sourceVideoPath)) ?? 0) / 1000;
  if (durationSec <= 0) return fail(`源视频时长探测失败: ${vp.sourceVideoPath}`, 500);

  const outDir = path.join(vp.productionRoot, 'overlay-studio');
  await fs.mkdir(outDir, { recursive: true });

  // SRT —— Studio 里"导入字幕"与人工核对都用得上
  const srtPath = path.join(outDir, 'transcript.srt');
  const ts = (sec: number) => {
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60); const ms = Math.round((sec - Math.floor(sec)) * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
  };
  await fs.writeFile(srtPath, segments
    .map((s, i) => `${i + 1}\n${ts(s.startSec)} --> ${ts(s.endSec)}\n${s.text}\n`)
    .join('\n'));

  const deepseekKey = await resolveDeepSeekApiKey(user.id);
  if (!deepseekKey) return fail('未配置 DeepSeek key', 500);
  const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });

  const jsonPath = path.join(outDir, 'overlay.json');
  let warns: string[] = [];
  try {
    const built = await buildOverlayArrangement({
      llm,
      segments,
      durationSec,
      runLint: async (doc) => {
        // lint 吃文件路径 —— 写临时文件喂给 Studio 的 CLI(阈值与用户 local 覆盖都在它那边)
        await fs.writeFile(jsonPath, JSON.stringify(doc, null, 2));
        return runOverlayLint(jsonPath, durationSec);
      },
    });
    warns = built.warns;
    await fs.writeFile(jsonPath, JSON.stringify(built.arrangement, null, 2));
  } catch (e) {
    return fail(e instanceof Error ? e.message : '编排生成失败', 500);
  }

  const { url } = await ensureStudioRunning().catch((e: Error) => {
    // 编排已经落盘 —— Studio 没起来不该把整次成果报废, 带着提示返回
    return { url: '', started: false, hint: e.message } as { url: string; started: boolean; hint?: string };
  });

  return ok({
    studioUrl: url || null,
    overlayJsonPath: jsonPath,
    srtPath,
    sourceVideoPath: vp.sourceVideoPath,
    warns,
  });
}
