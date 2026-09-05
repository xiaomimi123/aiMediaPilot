import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 三十二期 Task 4: 剪辑台「整片预览」音频流 —— `@remotion/player` 播 TTS 人声，
 * Player 拖时间轴要能 seek，所以必须支持 Range 请求(206 + Content-Range +
 * Accept-Ranges)，不能只做全量返回；否则拖进度条时浏览器拿不到中间字节。
 * 形状照抄同目录 `[id]/file` 路由：鉴权用 getOrCreateDefaultUser + vp.userId
 * 比对，404 口径也一致(别人的任务返 404，不泄漏存在性)。
 *
 * 音频文件路径固定为 `<productionRoot>/tts-audio.wav`。文件不存在是「无声任务」
 * 的正常情形 —— 例如 ppt-narration 没配 TTS 时出的片就没有人声轨，不是错误，
 * 同样返回 404，前端据此决定 Player 是否挂音频轨。
 *
 * 背景(复审读过 remotion/dist/cjs/audio/AudioForPreview.js 源码补充)：Remotion
 * 预览态的 `<Audio>` 底层就是原生 HTML `<audio>` 元素，Remotion 本身并不强制
 * 要求 Range —— Range 是浏览器原生媒体 seek 到未缓冲区间时的标准依赖。所以就算
 * 这里退化成 200 全量，3MB 量级的 TTS 音频也能播，只是拖进度条时体验变差(要
 * 等整段下载完)；稿子变长、音频体积上去后，这个降级面才会变成事实上的必要项。
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  const filePath = path.join(vp.productionRoot, 'tts-audio.wav');

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return fail('文件不存在', 404);
  }

  const range = req.headers.get('range');
  if (range) {
    // 多段 Range(如 `bytes=0-100,200-300`)：RFC 7233 §3.1 允许服务器直接忽略、
    // 按普通请求处理整个实体——好过只悄悄服务第一段, 让客户端以为拿到了完整
    // 内容却其实缺了后半段。畸形值(如 `bytes=abc`)同样匹配不上, 走同一条退化
    // 路径, 返回全量 200。
    const hasMultipleRanges = range.includes(',');
    const match = hasMultipleRanges ? null : /^bytes=(\d*)-(\d*)$/.exec(range);
    const hasStart = match?.[1] !== '' && match?.[1] !== undefined;
    const hasEnd = match?.[2] !== '' && match?.[2] !== undefined;

    if (match && (hasStart || hasEnd)) {
      let start: number;
      let end: number;
      if (!hasStart) {
        // 后缀式 `bytes=-500`：取文件末尾 500 字节 (RFC 7233 §2.1)。
        const suffixLength = parseInt(match[2], 10);
        start = Math.max(0, size - suffixLength);
        end = size - 1;
      } else {
        start = parseInt(match[1], 10);
        end = hasEnd ? parseInt(match[2], 10) : size - 1;
      }

      if (start >= size || end >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${size}` },
        });
      }

      const nodeStream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
        status: 206,
        headers: {
          'content-type': 'audio/wav',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': String(end - start + 1),
        },
      });
    }
    // 匹配失败(畸形/多段/空)：RFC 7233 §3.1 —— 无法解析的 Range 视为不存在,
    // 落到下面按普通请求处理, 全量 200。
  }

  const nodeStream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      'content-length': String(size),
    },
  });
}
