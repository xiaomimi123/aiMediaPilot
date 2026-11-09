import 'dotenv/config';

/**
 * 火山引擎 TTS(豆包语音合成大模型 2.0)——开源快讯档的 AI 配音。
 *
 * 接口: V3 单向流式 HTTP POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
 * 鉴权: 头 X-Api-App-Key(AppID) / X-Api-Access-Key(Access Token) / X-Api-Resource-Id: seed-tts-2.0
 * 响应: 流式多行 JSON, 每行一个 chunk, data 字段 base64 音频按顺序拼接。
 *
 * 2026-11-09 真机验证:
 * - 凭据走 V1 接口(/api/v1/tts, Bearer;token)全部 3001 resource not granted —— 账号开的是 2.0, 只有 seed-tts-2.0 有权限
 * - 音色只有 _uranus_bigtts 系列(2.0 专属)可用, 其他命名(如 _mars_bigtts)报 55000000 resource mismatched
 */

export const TTS_RESOURCE_ID = 'seed-tts-2.0';
const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

export interface TtsConfig {
  appKey: string;
  accessKey: string;
}

export function ttsConfigFromEnv(): TtsConfig | null {
  const appKey = process.env.VOLC_TTS_APPID?.trim();
  const accessKey = process.env.VOLC_TTS_TOKEN?.trim();
  if (!appKey || !accessKey) return null;
  return { appKey, accessKey };
}

/** 默认音色: 爽快知性女声(Vivi 2.0), 快讯档语速感合适; 换音色只改这里 */
export const DEFAULT_SPEAKER = 'zh_female_vv_uranus_bigtts';

export interface TtsOptions {
  text: string;
  speaker?: string;
  /** 0.2~2.0, 默认 1.1(快讯档稍快) */
  speedRatio?: number;
}

export interface TtsResult {
  mp3: Buffer;
  /** 首个错误码之外的响应码(20000000 = 成功) */
  code: number;
}

/**
 * 合成一段 mp3。文本超长时按句子切成多段分别合成再拼接(接口单次建议 <300 字,
 * mp3 帧直接拼接即可连续播放; ffprobe 验过 8.7s 成品完整)。
 */
export async function synthesizeSpeech(opts: TtsOptions, cfg: TtsConfig): Promise<TtsResult> {
  const chunks = splitText(opts.text);
  if (!chunks.length) throw new Error('配音文本是空的');
  const parts: Buffer[] = [];
  let code = 20000000;
  for (const chunk of chunks) {
    const r = await synthOnce({ ...opts, text: chunk }, cfg);
    parts.push(r.mp3);
    code = r.code;
  }
  return { mp3: Buffer.concat(parts), code };
}

/** 按句切分, 每段不超 ~280 字(留出余量; 1024 字节是 UTF-8 硬限) */
export function splitText(text: string, maxChars = 280): string[] {
  const t = text.trim();
  if (Array.from(t).length <= maxChars) return t ? [t] : [];
  const sentences = t.match(/[^。！？!?\n]+[。！？!?\n]*/g) ?? [t];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (Array.from(cur + s).length > maxChars && cur) {
      out.push(cur);
      cur = s.trim();
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function synthOnce(opts: TtsOptions, cfg: TtsConfig): Promise<TtsResult> {
  const body = {
    user: { uid: 'mediapilot' },
    req_params: {
      speaker: opts.speaker ?? DEFAULT_SPEAKER,
      text: opts.text,
      text_type: 'plain',
      audio_params: { format: 'mp3' },
      ...(opts.speedRatio !== undefined ? { speech_rate: opts.speedRatio } : {}),
    },
  };
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-Api-App-Key': cfg.appKey,
      'X-Api-Access-Key': cfg.accessKey,
      'X-Api-Resource-Id': TTS_RESOURCE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { header?: { code?: number; message?: string } };
      if (j.header?.message) msg += `：${j.header.message}`;
    } catch {
      if (text) msg += `：${text.slice(0, 120)}`;
    }
    throw new Error(`火山 TTS 请求失败：${msg}`);
  }
  // 流式多行 JSON: 逐行解析, data 拼接
  const raw = await res.text();
  let code = 20000000;
  let message = '';
  const audio: Buffer[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d: { code?: number; message?: string; data?: string };
    try {
      d = JSON.parse(t) as typeof d;
    } catch {
      continue;
    }
    if (d.code !== undefined) code = d.code;
    if (d.message) message = d.message;
    if (d.data) audio.push(Buffer.from(d.data, 'base64'));
  }
  const mp3 = Buffer.concat(audio);
  if (code !== 20000000 || !mp3.length) {
    throw new Error(code === 55000000 ? `音色不可用（${opts.speaker ?? DEFAULT_SPEAKER}）：这个账号只开了 2.0 的部分音色，换 _uranus_bigtts 系列的音色` : `火山 TTS 合成失败（${code}）：${message || '无音频返回'}`);
  }
  return { mp3, code };
}
