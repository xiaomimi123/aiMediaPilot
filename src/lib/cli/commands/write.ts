import { createProject } from '@/lib/project/create';
import { createProjectFromVideo } from '@/lib/benchmark/adopt';
import { finalizeScript } from '@/lib/script/finalize';
import { makePublishKit } from '@/lib/retro/state';
import { linkWork } from '@/lib/retro/match';
import { resolveLink } from '@/lib/benchmark/link';
import { createRetroDeps, generateRetro } from '@/lib/retro/generate';
import { updateLesson } from '@/lib/retro/lessons';
import { handlePaste } from '@/lib/benchmark/paste';
import { analyzeVideo } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';
import { createDouyinClient } from '@/lib/benchmark/douyin';
import { createPrismaStore } from '@/lib/benchmark/store';
import { takeSearchQuota, SEARCH_DAILY_LIMIT } from '@/lib/benchmark/quota';
import { createTaskDeps, isTaskKey, startManualRun } from '@/lib/tasks/nightly';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { CliError, needArg, type Command, type CommandCtx } from '../registry';


function llmOrThrow() {
  const key = getDeepSeekKey();
  if (!key) throw new CliError('no_deepseek_key', '没有配置 DeepSeek key：去设置页填入后再试。');
  return new DeepSeekTextLLM({ apiKey: key });
}

/** lib 里抛的普通 Error(如"找不到这个项目")转成 not_found / failed */
async function wrap<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof CliError) throw e;
    const m = e instanceof Error ? e.message : String(e);
    if (/找不到|不存在/.test(m)) throw new CliError('not_found', m);
    throw e;
  }
}

async function setAccountStatus(ctx: CommandCtx, id: string, status: string) {
  const a = await ctx.db.benchmarkAccount.findUnique({ where: { id } });
  if (!a) throw new CliError('not_found', '找不到这个对标账号（id 从 mp topics accounts 里取）。');
  await ctx.db.benchmarkAccount.update({ where: { id }, data: { status } });
  return { id, nickname: a.nickname, status };
}

const lessonCmd = (verb: 'adopt' | 'reject' | 'retire', status: string, hermes: boolean, summary: string): Command => ({
  path: ['lessons', verb],
  tier: 'write',
  hermes,
  usage: `mp lessons ${verb} <经验>`,
  summary,
  run: (ctx, p) => wrap(() => updateLesson(ctx.db, needArg(p, 0, '经验'), { status })),
  format: (d) => `${summary}：${(d as { text: string }).text}`,
});

export const WRITE_COMMANDS: Command[] = [
  {
    path: ['topics', 'ignore'],
    tier: 'write',
    hermes: true,
    usage: 'mp topics ignore <作品>',
    summary: '忽略对标作品',
    async run(ctx, p) {
      const id = needArg(p, 0, '作品');
      const v = await ctx.db.benchmarkVideo.findUnique({ where: { id } });
      if (!v) throw new CliError('not_found', '找不到这条对标作品。');
      await ctx.db.benchmarkVideo.update({ where: { id }, data: { status: 'ignored' } });
      return { id };
    },
    format: () => '已忽略。',
  },
  { path: ['topics', 'follow'], tier: 'write', hermes: false, usage: 'mp topics follow <账号>', summary: '关注对标账号', run: (ctx, p) => setAccountStatus(ctx, needArg(p, 0, '账号'), 'following'), format: (d) => `已关注 ${(d as { nickname: string }).nickname}` },
  { path: ['topics', 'unfollow'], tier: 'write', hermes: false, usage: 'mp topics unfollow <账号>', summary: '取消关注对标账号', run: (ctx, p) => setAccountStatus(ctx, needArg(p, 0, '账号'), 'candidate'), format: (d) => `已取消关注 ${(d as { nickname: string }).nickname}` },
  {
    path: ['topics', 'paste'],
    tier: 'douyin',
    hermes: false,
    usage: 'mp topics paste <分享链接或文本>',
    summary: '粘贴抖音链接并拆解',
    async run(ctx, p) {
      const text = p.positionals.join(' ');
      const target = text ? await resolveLink(text).catch(() => null) : null;
      if (!target) throw new CliError('bad_args', '这不是抖音视频或主页链接。');
      let queued: string | null = null;
      const r = await handlePaste({ store: createPrismaStore(ctx.db), client: createDouyinClient(), enqueue: (id) => ((queued = id), true), now: () => ctx.now }, target);
      // CLI 进程退出后内存队列就没了: 同步把拆解跑完
      if (queued) {
        ctx.progress('拆解中（下载、转写、分析，约 1 分钟）…');
        await analyzeVideo(await createAnalyzeDeps(ctx.db), queued);
      }
      return r;
    },
    format: (d) => ((d as { kind: string }).kind === 'video' ? `已加入并拆解（id ${(d as { videoId: string }).videoId}，用 mp topics show 查看）` : '已关注这个博主'),
  },
  {
    path: ['topics', 'analyze'],
    tier: 'douyin',
    hermes: false,
    usage: 'mp topics analyze <作品>',
    summary: '拆解对标作品',
    async run(ctx, p) {
      const id = needArg(p, 0, '作品');
      if (!(await ctx.db.benchmarkVideo.findUnique({ where: { id } }))) throw new CliError('not_found', '找不到这条对标作品。');
      ctx.progress('拆解中（下载、转写、分析，约 1 分钟）…');
      const ok = await analyzeVideo(await createAnalyzeDeps(ctx.db), id);
      const v = await ctx.db.benchmarkVideo.findUniqueOrThrow({ where: { id } });
      if (!ok) throw new CliError('failed', v.analysisError ?? '拆解失败');
      return { id };
    },
    format: (d) => `拆解完成，用 mp topics show ${(d as { id: string }).id} 查看。`,
  },
  {
    path: ['topics', 'search'],
    tier: 'douyin',
    hermes: false,
    usage: 'mp topics search <关键词>',
    summary: '按关键词搜博主(候选)',
    async run(ctx, p) {
      const kw = p.positionals.join(' ').trim();
      if (!kw || kw.length > 20) throw new CliError('bad_args', '输入一个关键词（20 字以内）');
      if (!(await takeSearchQuota())) throw new CliError('quota', `今天搜索次数用完了（每天 ${SEARCH_DAILY_LIMIT} 次，保护账号），明天再搜。`);
      const store = createPrismaStore(ctx.db);
      const found = await createDouyinClient().searchUsers(kw);
      const rows = [];
      for (const u of found) rows.push(await store.upsertAccount(u, { status: 'candidate', source: 'search', searchKeyword: kw }));
      return rows.map((a) => ({ id: a.id, nickname: a.nickname, followers: a.followers, status: a.status }));
    },
    format: (d) => (d as { id: string; nickname: string; followers: number; status: string }[]).map((a) => `[${a.id}] ${a.nickname} · ${a.followers} 粉 · ${a.status === 'following' ? '已关注' : '候选'}`).join('\n') || '没搜到。',
  },
  {
    path: ['project', 'new'],
    tier: 'write',
    hermes: true,
    usage: 'mp project new [--title 标题] [--from-video 对标作品]',
    summary: '建项目',
    async run(ctx, p) {
      const title = typeof p.flags.title === 'string' ? p.flags.title : undefined;
      const from = typeof p.flags['from-video'] === 'string' ? p.flags['from-video'] : undefined;
      if (from) {
        if (!(await ctx.db.benchmarkVideo.findUnique({ where: { id: from } }))) throw new CliError('not_found', '找不到这条对标作品。');
        const r = await createProjectFromVideo(ctx.db, from, title);
        return { id: r.id };
      }
      return { id: (await createProject(ctx.db, title)).id };
    },
    format: (d) => `已建项目 ${(d as { id: string }).id}`,
  },
  {
    path: ['script', 'finalize'],
    tier: 'write',
    hermes: false,
    usage: 'mp script finalize <项目>',
    summary: '定稿',
    run: (ctx, p) => wrap(async () => ({ id: (await finalizeScript(ctx.db, needArg(p, 0, '项目'))).id })),
    format: () => '已定稿，下一步：录口播并在项目页上传。',
  },
  {
    path: ['publish', 'kit'],
    tier: 'write',
    hermes: false,
    usage: 'mp publish kit <项目>',
    summary: '生成发布文案',
    run: (ctx, p) => wrap(() => makePublishKit(ctx.db, needArg(p, 0, '项目'), llmOrThrow())),
    format(d) {
      const k = d as { titles: string[]; hashtags: string[]; coverText: string[] };
      return [...k.titles.map((t, i) => `标题${i + 1}：${t}`), `话题：${k.hashtags.join(' ')}`, `封面字：${k.coverText.join(' / ')}`].join('\n');
    },
  },
  {
    path: ['publish', 'link'],
    tier: 'write',
    hermes: true,
    usage: 'mp publish link <项目> <作品id或分享链接>',
    summary: '关联发布的作品',
    async run(ctx, p) {
      const projectId = needArg(p, 0, '项目');
      const ref = p.positionals.slice(1).join(' ');
      if (!ref) throw new CliError('bad_args', '缺少参数：作品id或分享链接');
      let workId = ref;
      if (/douyin\.com|^\S*\s|https?:/.test(ref)) {
        const t = await resolveLink(ref).catch(() => null);
        if (!t || t.kind !== 'video') throw new CliError('bad_args', '这不是抖音视频链接。');
        const w = await ctx.db.publishedWork.findFirst({ where: { platform: 'douyin', externalId: t.awemeId } });
        if (!w) throw new CliError('not_found', '库里还没有这条作品（可能刚发布），等今晚回采后再关联。');
        workId = w.id;
      } else if (!(await ctx.db.publishedWork.findUnique({ where: { id: workId } }))) throw new CliError('not_found', '找不到这条作品。');
      await wrap(() => linkWork(ctx.db, projectId, workId));
      return { projectId, workId };
    },
    format: () => '已关联，第 3 天会自动复盘。',
  },
  {
    path: ['retro', 'run'],
    tier: 'write',
    hermes: false,
    usage: 'mp retro run <项目>',
    summary: '生成复盘',
    async run(ctx, p) {
      const r = await generateRetro(createRetroDeps(ctx.db), needArg(p, 0, '项目'));
      if (!r.ok) throw new CliError('failed', r.reason);
      return { done: true };
    },
    format: () => '复盘已生成，用 mp retro show 查看。',
  },
  lessonCmd('adopt', 'active', true, '已采纳'),
  lessonCmd('reject', 'rejected', true, '已不要'),
  lessonCmd('retire', 'retired', false, '已停用'),
  {
    path: ['tasks', 'run'],
    tier: 'douyin',
    hermes: false,
    usage: 'mp tasks run <collect|scan>',
    summary: '立即运行每晚任务',
    async run(_ctx, p) {
      const key = needArg(p, 0, '任务（collect 或 scan）');
      if (!isTaskKey(key)) throw new CliError('bad_args', '任务只能是 collect（作品数据回采）或 scan（对标巡检）');
      const r = await startManualRun(createTaskDeps(), key);
      if (!r.ok) throw new CliError(/正在跑/.test(r.reason) ? 'running' : 'quota', r.reason);
      return { started: true, left: r.left };
    },
    format: (d) => `已开始（后台跑，结果看 mp tasks status），今天还能手动 ${(d as { left: number }).left} 次。`,
  },
];
