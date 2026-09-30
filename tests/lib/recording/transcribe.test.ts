import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTranscribe, whisperErrorMessage, type TranscribeDeps } from '@/lib/recording/transcribe';
import { JobError, type JobContext } from '@/lib/jobs/runner';
import { SEGMENT_ROLES } from '@/lib/script/model';
import { createFakeDb } from '../../helpers/fake-db';

const texts = ['你敢不敢让AI骂你的方案', '大多数人只让它帮忙写', '换个说法让它当评审', '模型会顺着你说', '所以要逼它挑刺', '方案是被骂出来的'];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: texts[i] })) };

async function setup(opts: { stage?: string; withVideo?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-tx-'));
  const video = path.join(dir, 'raw.v2.mov');
  await fs.writeFile(video, 'fake');
  const fake = createFakeDb({
    project: { script, stage: opts.stage ?? 'scripted' },
    files: opts.withVideo === false ? [] : [{ kind: 'raw_video', path: video, version: 2 }],
  });
  const progress: number[] = [];
  const ctx: JobContext = { jobId: 'j1', projectId: 'p1', db: fake.db, progress: async (p) => void progress.push(p) };
  return { ...fake, ctx, dir, progress };
}

const okDeps = (spoken: string[]): TranscribeDeps => ({
  extractAudio: async (_v, audio) => fs.writeFile(audio, 'wav'),
  transcribeAudio: async () => ({ segments: spoken.map((t, i) => ({ startSec: i * 3, endSec: i * 3 + 3, text: t })), durationSec: spoken.length * 3 }),
  proofread: async (_s, lines) => ({ lines, status: 'done', changed: 1 }),
});

describe('runTranscribe', () => {
  it('writes transcript.v<N>.json next to the video, records the file, advances the stage, removes the audio', async () => {
    const { ctx, dir, files, project, progress } = await setup();
    const out = await runTranscribe(ctx, okDeps(texts));
    const t = files.find((f) => f.kind === 'transcript')!;
    expect(t).toMatchObject({ version: 2, path: path.join(dir, 'transcript.v2.json') });
    const saved = JSON.parse(await fs.readFile(t.path, 'utf8'));
    expect(saved).toMatchObject({ durationSec: 18, proofread: 'done' });
    expect(saved.lines).toHaveLength(6);
    expect(project.stage).toBe('recorded');
    await expect(fs.access(path.join(dir, 'audio.v2.wav'))).rejects.toThrow();
    expect(progress).toEqual([0.1, 0.8, 0.95]);
    expect(out.notice).toBe('转写完成：6 句，约 18 秒，校对改了 1 处识别错字。和稿子基本一致。');
  });

  it('reports adlib lines and skipped segments in the notice', async () => {
    const { ctx } = await setup();
    const spoken = [...texts.filter((_, i) => i !== 3), '对了上周我还去爬了趟山'];
    const out = await runTranscribe(ctx, okDeps(spoken));
    expect(out.notice).toContain('和稿子比：1 句是临场加的，1 段没讲到。');
  });

  it('does not move a project backwards', async () => {
    const { ctx, project } = await setup({ stage: 'final' });
    await runTranscribe(ctx, okDeps(texts));
    expect(project.stage).toBe('final');
  });

  it('fails with a readable message when no video was uploaded', async () => {
    const { ctx } = await setup({ withVideo: false });
    await expect(runTranscribe(ctx, okDeps(texts))).rejects.toMatchObject({ userMessage: '还没有口播视频，先上传一个再转写。' });
  });

  it('wraps whisper failures in a JobError with the mapped message', async () => {
    const { ctx } = await setup();
    const deps = { ...okDeps(texts), transcribeAudio: async () => { throw Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }); } };
    const err = await runTranscribe(ctx, deps).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err.userMessage).toContain('找不到 Python');
  });

  it('mentions when proofreading failed but still succeeds', async () => {
    const { ctx } = await setup();
    const deps = { ...okDeps(texts), proofread: async (_s: unknown, lines: never[]) => ({ lines, status: 'failed' as const, changed: 0 }) };
    const out = await runTranscribe(ctx, deps);
    expect(out.notice).toContain('（自动校对没成功，用的是原始识别结果）');
  });
});

describe('whisperErrorMessage', () => {
  it('maps missing python / missing module / timeout', () => {
    expect(whisperErrorMessage(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toContain('找不到 Python');
    expect(whisperErrorMessage(new Error("ModuleNotFoundError: No module named 'faster_whisper'"))).toContain('pip install faster-whisper');
    expect(whisperErrorMessage(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))).toContain('超时');
    expect(whisperErrorMessage(new Error('boom'))).toBe('本地转写出错了。点「重试」再跑一次，还不行就把详情发给我。');
  });
});
