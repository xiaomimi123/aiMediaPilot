import { randomUUID } from 'crypto';
import fs from 'fs/promises';

import { probeVideo } from '@/lib/video/ffmpeg';

/**
 * 火山引擎(豆包语音) TTS 客户端封装。
 *
 * ## 技术验证结论(十九期 Task 9, 2026-08-22 真实调通)
 *
 * 本文件的契约是**实测得出**的，与 spec 最初假设的 `appId + accessToken` 双字段鉴权
 * **不同**——实测账号提供的是单一 UUID 格式凭证，鉴权方式是**单一 API Key**：
 *
 * - 端点: `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`
 *   (文档称"HTTP Chunked/SSE 单向流式-V3"，属于新版"豆包语音大模型"体系)
 * - 鉴权 header: `X-Api-Key: <apiKey>`（不需要 appid/access-token 二元组；
 *   旧版 `X-Api-App-Id` + `X-Api-Access-Key` 组合在实测账号上返回
 *   `load grant: requested grant not found in SaaS storage`，说明该账号只开通了
 *   新版单 Key 鉴权体系）。
 * - 另需 `X-Api-Resource-Id` header 指定资源档位（实测账号仅 `seed-tts-2.0`
 *   有权限；`seed-tts-1.0`/`volc.service_type.10029` 返回
 *   `requested resource not granted`）。
 * - 请求体: `{ user: { uid }, req_params: { text, speaker, audio_params: { format, sample_rate } } }`。
 *   `speaker` 即音色/voiceType，seed-tts-2.0 档位下的音色 id 后缀为
 *   `_uranus_bigtts`（如 `zh_female_vv_uranus_bigtts`），旧档位常见的
 *   `_mars_bigtts`/`_moon_bigtts` 系列音色在 seed-tts-2.0 下会报
 *   `resource ID is mismatched with speaker related resource`。
 * - **响应不是单个 JSON、也不是纯二进制**：HTTP 200 body 是若干行以换行分隔的 JSON
 *   对象（同步一次性返回，不需要额外 WebSocket/轮询）。每行 `{ code, message, data }`，
 *   `data` 是本段 base64 编码的 mp3 音频片段，需要把所有非 null 的 `data` 按顺序
 *   拼接后再 base64 解码，才是完整音频。中间可能夹杂 `data: null` 的元信息行
 *   （如逐句时间戳），结尾有一行 `code: 20000000, message: "OK"` 表示流结束。
 * - **响应中没有音频时长字段**——必须用 ffprobe 探测写盘后的文件才能拿到
 *   `durationMs`（复用 `probeVideo`，本身就是通用 ffprobe 包装，音频文件同样适用）。
 *
 * 已用真实凭证(`VOLC_TTS_API_KEY`)对该端点做过一次真实调用，产出 61293 字节的合法
 * mp3(ffprobe 探测时长 7.656s)，验证了以上契约。
 */

const VOLC_TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const DEFAULT_RESOURCE_ID = 'seed-tts-2.0';
const DEFAULT_VOICE_TYPE = 'zh_female_vv_uranus_bigtts';
const TIMEOUT_MS = 60_000;

export interface VolcTtsOpts {
  /** 单一 API Key(实测鉴权方式，非 appId+accessToken 二元组)。 */
  apiKey: string;
  /** 音色/说话人 id，对应请求体 req_params.speaker。默认用实测跑通的音色。 */
  voiceType?: string;
  /** 资源档位，对应 X-Api-Resource-Id header。默认 'seed-tts-2.0'(实测账号唯一有权限的档位)。 */
  resourceId?: string;
}

export interface VolcTtsResult {
  audioPath: string;
  durationMs: number;
}

interface VolcTtsStreamLine {
  code?: number;
  message?: string;
  data?: string | null;
}

function parseStreamLines(raw: string): VolcTtsStreamLine[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as VolcTtsStreamLine;
      } catch {
        throw new Error(`火山引擎 TTS 响应包含非法 JSON 行: ${line.slice(0, 200)}`);
      }
    });
}

/** 20000000 是流结束的正常状态码，0 是每个分片的正常状态码；其余一律视为错误。 */
function isErrorCode(code: number | undefined): boolean {
  return code !== undefined && code !== 0 && code !== 20000000;
}

export async function synthesizeVolcTts(
  text: string,
  outputPath: string,
  opts: VolcTtsOpts
): Promise<VolcTtsResult> {
  if (!opts?.apiKey) {
    throw new Error('synthesizeVolcTts: 缺少 apiKey(火山引擎 API Key)');
  }
  if (!text || !text.trim()) {
    throw new Error('synthesizeVolcTts: 缺少待合成文本 text');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(VOLC_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': opts.apiKey,
        'X-Api-Resource-Id': opts.resourceId ?? DEFAULT_RESOURCE_ID,
        'X-Api-Request-Id': randomUUID(),
      },
      body: JSON.stringify({
        user: { uid: 'mediapilot' },
        req_params: {
          text,
          speaker: opts.voiceType ?? DEFAULT_VOICE_TYPE,
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`火山引擎 TTS 请求超时 (${TIMEOUT_MS / 1000}s)`);
    }
    throw new Error(`火山引擎 TTS 请求失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await res.text();

  if (!res.ok) {
    throw new Error(`火山引擎 TTS 请求失败 (status ${res.status}): ${rawBody.slice(0, 500)}`);
  }

  const lines = parseStreamLines(rawBody);

  const errorLine = lines.find((l) => isErrorCode(l.code));
  if (errorLine) {
    throw new Error(
      `火山引擎 TTS 返回错误 (code ${errorLine.code}): ${errorLine.message ?? '未知错误'}`
    );
  }

  const audioB64 = lines
    .map((l) => l.data)
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .join('');

  if (!audioB64) {
    throw new Error('火山引擎 TTS 响应中未找到音频数据(data 字段)');
  }

  const audioBuf = Buffer.from(audioB64, 'base64');
  await fs.writeFile(outputPath, audioBuf);

  const probeResult = await probeVideo(outputPath);
  const durationMs = Math.round(probeResult.durationSec * 1000);

  return { audioPath: outputPath, durationMs };
}
