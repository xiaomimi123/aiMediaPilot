import 'dotenv/config';
import { Worker } from 'bullmq';
import path from 'path';
import { promises as fs } from 'fs';
import type { Prisma } from '@prisma/client';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { QUEUES } from '@/jobs/queue';
import { extractAudio } from '@/lib/video/ffmpeg';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { TEARDOWN } from '@/lib/llm/prompts/teardown';

/**
 * 对标视频拆解 worker(二十三期)。
 *
 * 为什么只有转写走队列: 拆解本身一次 DeepSeek 调用几秒钟, 贴转写稿的入口是**同步**
 * 跑完的 —— 那是刻意的, 因为入队意味着要 worker 在跑, 而这个项目已经因为 worker
 * 静默不跑吃过大亏(9 次出片 0 成功)。但本地 Whisper 大约 1x 实时, 一条三分钟的
 * 片子要跑三分钟, 撑不住一个 HTTP 请求, 只能入队。
 *
 * 所以这条队列做两件事: 抽音轨 + 转写, 然后**复用同一段拆解逻辑**接着往下跑完。
 * 转写完成就先落库 —— 转写是这一步里最贵的产物, 后面的拆解失败了也不该让它重跑。
 */

interface JobData {
  teardownId: string;
}

async function setStatus(id: string, status: string, data: Record<string, unknown> = {}) {
  await prisma.teardown.update({ where: { id }, data: { status, ...data } });
}

async function run(job: { data: JobData }) {
  const { teardownId } = job.data;
  const td = await prisma.teardown.findUnique({ where: { id: teardownId } });
  if (!td) throw new Error('拆解记录不存在');
  if (!td.sourceVideoPath) throw new Error('没有待转写的视频');

  // 转写已经做过就跳过 —— 重试时不该再花三分钟做同一件事
  let transcript = td.transcript;
  if (transcript.trim().length === 0) {
    await setStatus(teardownId, 'transcribing');
    const audioPath = path.join(path.dirname(td.sourceVideoPath), 'audio.wav');
    await extractAudio({ videoPath: td.sourceVideoPath, audioPath });
    const whisper = new LocalWhisperClient();
    const result = await whisper.transcribe(audioPath);
    transcript = result.text.trim();
    await fs.unlink(audioPath).catch(() => {});

    if (transcript.length < 50) {
      throw new Error(`转写结果只有 ${transcript.length} 个字, 太短拆不出东西 —— 检查视频里有没有人声`);
    }
    await setStatus(teardownId, 'analyzing', { transcript });
  } else {
    await setStatus(teardownId, 'analyzing');
  }

  const apiKey = await resolveDeepSeekApiKey(td.userId);
  if (!apiKey) throw new Error('未配置 DeepSeek key');

  const llm = getDeepSeekTextLLM(apiKey);
  const out = await llm.callStructured({
    systemPrompt: TEARDOWN.buildSystemPrompt('ai-knowledge'),
    userMessage: TEARDOWN.buildUserMessage({
      title: td.title,
      author: td.author,
      transcript,
    }),
    responseSchema: TEARDOWN.responseSchema,
  });

  await setStatus(teardownId, 'done', {
    result: out.result as unknown as Prisma.InputJsonObject,
  });
}

export function startTeardownWorker() {
  const worker = new Worker<JobData>(
    QUEUES.TEARDOWN,
    async (job) => {
      try {
        await run(job);
      } catch (e) {
        console.error('[teardown-worker]', e);
        // 失败也把转写留住 —— 它是这条链路上最贵的产物
        await prisma.teardown.update({
          where: { id: job.data.teardownId },
          data: {
            status: 'failed',
            errorMessage: e instanceof Error ? e.message.slice(0, 300) : '拆解失败',
          },
        }).catch(() => {});
        throw e;
      }
    },
    { connection: redis, concurrency: 1 },
  );
  return worker;
}
