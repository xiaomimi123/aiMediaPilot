import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { ActKey } from '@/lib/script/six-act';

/**
 * TTS 幂等清单 (二十八期终审) —— 判断"这次 preview 能不能复用上次合成的语音"。
 *
 * 为什么要绑内容指纹, 不能只看文件在不在:
 * 六幕稿文本改过之后, 旧的 tts-<act>.mp3 依然会原地存在(worker 从不主动删它),
 * 如果只判断"文件存在就跳过", 改稿重生成会拿到**旧配音配新画面** —— 这比每次都
 * 重新调用 TTS API 更糟: 白烧 API 至少音画是一致的, 而音画不一致是一次静默事故,
 * 用户不会去逐句核对配音是不是新稿子的内容。
 *
 * 为什么任何一幕不一致就整体重来, 不做"部分复用部分重合成":
 * 六幕的 startMs/endMs 是首尾相接累加出来的(ttsResultsToAlignedActs), 只重合成
 * 其中一幕会导致该幕之后所有幕的时间边界全部偏移, 而字幕/分镜窗口都是按这份边界
 * 算出来的 —— 混着新旧时长拼接，会把整条时间轴拼错位。整体重来虽然多花几次 API
 * 调用，但永远不会出现"部分对得上、部分对不上"的中间状态。
 */

/** 参与哈希与比对的最小字段——不含 audioPath, 路径是运行时算出来的，不是内容的一部分。 */
export interface TtsManifestEntry {
  act: ActKey;
  /** narration 文本的哈希(sha256 hex)，不直接存明文，避免清单文件无谓变大。 */
  narrationHash: string;
  voiceType: string;
  durationMs: number;
}

export interface TtsManifest {
  entries: TtsManifestEntry[];
}

/** narration 文本 → 稳定哈希。纯函数，供构建清单与比对复用同一套算法。 */
export function hashNarration(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** 由本次实际合成结果构建清单(preview 合成完之后落盘用)。 */
export function buildTtsManifest(
  acts: { act: ActKey; narration: string }[],
  voiceType: string,
  durationsMs: Record<string, number>,
): TtsManifest {
  return {
    entries: acts.map((a) => ({
      act: a.act,
      narrationHash: hashNarration(a.narration),
      voiceType,
      durationMs: durationsMs[a.act] ?? 0,
    })),
  };
}

/**
 * 判断已有清单是否可以整体复用。
 *
 * 逐幕比对哈希与 voiceType 都一致才算数——任何一幕缺失/不一致，或清单本身
 * 缺失/损坏(JSON.parse 失败等), 一律返回 false, 交由调用方走整体重合成
 * (损坏的清单不是异常, 是"没有可复用证据", 重来就是安全路径, 不应该抛错)。
 */
export function ttsManifestMatches(
  acts: { act: ActKey; narration: string }[],
  manifest: TtsManifest | null | undefined,
  voiceType: string,
): boolean {
  if (!manifest || !Array.isArray(manifest.entries)) return false;
  if (manifest.entries.length !== acts.length) return false;
  const byAct = new Map(manifest.entries.map((e) => [e.act, e]));
  return acts.every((a) => {
    const entry = byAct.get(a.act);
    if (!entry) return false;
    return entry.voiceType === voiceType && entry.narrationHash === hashNarration(a.narration);
  });
}

/** manifest JSON 文本 → TtsManifest，解析失败返回 null(损坏当作"没有清单"，走重来)。 */
export function parseTtsManifest(raw: string): TtsManifest | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed as TtsManifest;
  } catch {
    return null;
  }
}

/** 找出某一幕在清单里的合成时长——复用时不重新 ffprobe，直接读这里落盘的值。 */
export function durationOfAct(manifest: TtsManifest, act: ActKey): number | null {
  const entry = manifest.entries.find((e) => e.act === act);
  return entry ? entry.durationMs : null;
}

/*
 * 下面两个是带 I/O 的辅助函数（读文件/探文件），特意不放进 worker 的
 * handlePptNarrationRemotion 函数体——那个函数体有一条源码级锚点测试
 * (「有配置分支不吞 TTS 失败」)专门禁止 `if (ttsConfig)` 分支里出现 catch，
 * 目的是不让人把真正的 synthesizeVolcTts 调用悄悄包进 try/catch 吞掉失败。
 * 这里的 try/catch 只是"清单文件读不到/损坏就当没有"，与吞 TTS 失败是两件事，
 * 放在这个独立文件里就不会撞上那条锚点，也更符合"I/O 归 I/O、判断归纯函数"的分工。
 */

/** 读清单文件；文件不存在或内容损坏都返回 null（不抛错——没有清单就是没法复用）。 */
export async function readTtsManifestFile(filePath: string): Promise<TtsManifest | null> {
  try {
    return parseTtsManifest(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 清单说一致不等于 mp3 真的还在——逐幕探一遍文件是否存在。 */
export async function ttsAudioFilesExist(productionRoot: string, acts: { act: ActKey }[]): Promise<boolean> {
  for (const a of acts) {
    try {
      await fs.access(path.join(productionRoot, `tts-${a.act}.mp3`));
    } catch {
      return false;
    }
  }
  return true;
}
