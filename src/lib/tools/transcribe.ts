import { z } from 'zod';
import { findActiveJob } from '@/lib/jobs/runner';
import { launchJob } from '@/lib/jobs/registry';
import type { Tool } from './types';

const Input = z.object({});

export const transcribeTool: Tool<z.infer<typeof Input>> = {
  name: 'transcribe',
  label: '转写',
  description: '重新转写最近上传的口播视频(后台任务, 1～3 分钟)。上传后系统会自动转写, 只有用户要求重新转写时才调用。',
  input: Input,
  async execute(ctx) {
    const video = await ctx.db.projectFile.findFirst({ where: { projectId: ctx.projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
    if (!video) return { ok: false, summary: '转写没开始：还没上传口播视频' };
    if (await findActiveJob(ctx.db, ctx.projectId, 'transcribe')) return { ok: false, summary: '转写没开始：已经在转写了' };
    await launchJob(ctx.db, ctx.projectId, 'transcribe');
    return { ok: true, summary: '已开始重新转写，1～3 分钟后出结果' };
  },
};
