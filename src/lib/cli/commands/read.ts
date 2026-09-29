import { buildAccountSummary } from '@/lib/account/summary';
import { readCollectStatus, readScanStatus, type CollectStatus } from '@/lib/douyin/collect-log';
import { findCandidate } from '@/lib/retro/match';
import { createPrismaStore } from '@/lib/benchmark/store';
import { toVideoView, type VideoView } from '@/lib/benchmark/view';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { loadPublishState, type PublishState } from '@/lib/retro/state';
import { toLessonView } from '@/lib/retro/view';
import { createTaskDeps, getSchedule, isTaskRunning, manualRunsLeft, NIGHTLY_TASKS, type TaskKey } from '@/lib/tasks/nightly';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { CliError, needArg, type Command } from '../registry';

export interface StatusData {
  fans: number | null;
  fansDelta: number | null;
  likes: number | null;
  hits24h: number;
  collect: string;
  scan: string;
  pendingLinks: number;
  lessonCandidates: number;
}

const n = (v: number) => v.toLocaleString('en-US');
const taskLine = (s: CollectStatus) => (s.state === 'ok' ? `正常（${new Date(s.lastSuccessAt!).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）` : `失败：${s.hint}`);

export function formatStatus(d: StatusData): string {
  const fans = d.fans === null ? '粉丝 还没回采到' : `粉丝 ${n(d.fans)}${d.fansDelta ? `（${d.fansDelta > 0 ? '+' : ''}${d.fansDelta}）` : ''}`;
  const pend = [d.pendingLinks ? `${d.pendingLinks} 条作品关联` : '', d.lessonCandidates ? `${d.lessonCandidates} 条写法经验` : ''].filter(Boolean).join('，');
  return [`${fans}${fans.endsWith('）') ? '' : ' '}· 获赞 ${d.likes === null ? '—' : n(d.likes)}`, `今天对标爆款 ${d.hits24h} 条`, `回采：${d.collect}`, `巡检：${d.scan}`, pend ? `待确认：${pend}` : '没有待确认的事'].join('\n');
}

export function formatHits(d: VideoView[]): string {
  if (!d.length) return '近期没有对标爆款。';
  return d.map((v) => `[${v.id}] ${v.author} · 平时的 ${v.ratio ?? '?'} 倍 · ${v.analysis?.topic ?? v.desc.slice(0, 30)}`).join('\n');
}

const ORDER: Record<string, number> = { bad: 0, good: 1, even: 2, na: 3 };

export function formatRetro(s: PublishState): string {
  if (!s.work) return s.candidate ? `还没关联作品；候选：${s.candidate.text.slice(0, 30)}（用 mp publish link 确认）` : '还没关联发布的作品。';
  if (!s.retro) return `已关联作品（播放 ${s.work.viewCount} · 点赞 ${s.work.likeCount}），还没有复盘。`;
  const r = s.retro;
  const d = r.diagnosis as { stages: { label: string; verdict: string; note: string }[] };
  const V: Record<string, string> = { bad: '差', good: '好', even: '平', na: '—' };
  const stages = [...d.stages].sort((a, b) => (ORDER[a.verdict] ?? 9) - (ORDER[b.verdict] ?? 9)).map((st) => `${V[st.verdict] ?? '—'} ${st.label}：${st.note}`);
  const lessons = s.lessons.map((l) => `[${l.id}] ${l.text}${l.status === 'candidate' ? '（待你决定）' : l.status === 'active' ? '（已生效）' : ''}`);
  return [
    `第 ${r.dayN} 天复盘 · 播放 ${s.work.viewCount} · 点赞 ${s.work.likeCount}`,
    ...stages,
    r.narrative ? `编导：${r.narrative}` : `编导：${r.narrativeError}`,
    ...(lessons.length ? ['写法经验：', ...lessons] : []),
  ].join('\n');
}

function llmOrThrow() {
  const key = getDeepSeekKey();
  if (!key) throw new CliError('no_deepseek_key', '没有配置 DeepSeek key：去设置页填入后再试。');
  return new DeepSeekTextLLM({ apiKey: key });
}

export const READ_COMMANDS: Command[] = [
  {
    path: ['status'],
    tier: 'read',
    hermes: true,
    usage: 'mp status',
    summary: '账号与任务概况',
    async run(ctx): Promise<StatusData> {
      const [c, s] = await Promise.all([readCollectStatus(ctx.now), readScanStatus(ctx.now)]);
      const sum = await buildAccountSummary(ctx.db, c, s);
      let pendingLinks = 0;
      for (const p of await ctx.db.project.findMany({ where: { stage: 'final' }, select: { id: true } })) if (await findCandidate(ctx.db, p.id)) pendingLinks++;
      const lessonCandidates = await ctx.db.writingLesson.count({ where: { status: 'candidate' } });
      return { fans: sum.fans, fansDelta: sum.fansDelta, likes: sum.likes, hits24h: sum.hits24h, collect: taskLine(c), scan: taskLine(s), pendingLinks, lessonCandidates };
    },
    format: (d) => formatStatus(d as StatusData),
  },
  {
    path: ['topics', 'hits'],
    tier: 'read',
    hermes: true,
    usage: 'mp topics hits [--days 14]',
    summary: '近期对标爆款',
    async run(ctx, p) {
      const days = Number(p.flags.days ?? 14);
      if (!Number.isFinite(days) || days <= 0) throw new CliError('bad_args', '--days 要是正数');
      const store = createPrismaStore(ctx.db);
      const rows = await store.listVideos({ isHit: true, statusNot: ['ignored'], publishedSince: new Date(ctx.now.getTime() - days * 86400_000), take: 30 });
      const names = new Map((await store.listAccounts()).map((a) => [a.id, a.nickname]));
      return rows.map((r) => toVideoView(r, names.get(r.accountId) ?? '', false, ctx.now));
    },
    format: (d) => formatHits(d as VideoView[]),
  },
  {
    path: ['topics', 'show'],
    tier: 'read',
    hermes: true,
    usage: 'mp topics show <作品>',
    summary: '对标作品的拆解与逐字稿',
    async run(ctx, p) {
      const store = createPrismaStore(ctx.db);
      const v = await store.getVideo(needArg(p, 0, '作品'));
      if (!v) throw new CliError('not_found', '找不到这条对标作品（id 从 mp topics hits 里取）。');
      const acc = await store.getAccount(v.accountId);
      return toVideoView(v, acc?.nickname ?? '', false, ctx.now);
    },
    format(d) {
      const v = d as VideoView;
      const a = v.analysis;
      return [
        `${v.author} · ${new Date(v.publishedAt).toLocaleDateString('zh-CN')} · ${n(v.digg)} 赞${v.ratio ? `（平时的 ${v.ratio} 倍）` : ''}`,
        a ? `选题：${a.topic}\n钩子（${a.hook.type}）：${a.hook.quote}\n标题写法：${a.titlePattern}\n契合度：${a.fit}（${a.fitReason}）\n你可以这么讲：${a.myAngle}` : `还没拆解（${v.analysisStatus === 'failed' ? v.analysisError : '在电脑上运行 mp topics analyze'}）`,
        v.transcript ? `逐字稿：\n${v.transcript}` : '',
        `原视频：${v.url}`,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    path: ['topics', 'accounts'],
    tier: 'read',
    hermes: true,
    usage: 'mp topics accounts',
    summary: '对标账号',
    async run(ctx) {
      const rows = await createPrismaStore(ctx.db).listAccounts();
      return rows.filter((a) => a.status !== 'ignored').map((a) => ({ id: a.id, nickname: a.nickname, status: a.status, followers: a.followers, baselineDigg: a.baselineDigg }));
    },
    format: (d) =>
      (d as { id: string; nickname: string; status: string; followers: number; baselineDigg: number | null }[])
        .map((a) => `[${a.id}] ${a.nickname} · ${a.status === 'following' ? '关注中' : '候选'} · ${n(a.followers)} 粉${a.baselineDigg ? ` · 平时约 ${n(a.baselineDigg)} 赞` : ''}`)
        .join('\n') || '还没有对标账号。',
  },
  {
    path: ['topics', 'suggest'],
    tier: 'read',
    hermes: true,
    usage: 'mp topics suggest',
    summary: '让编导从对标爆款里挑 3 个选题',
    async run(ctx) {
      const persona = await ctx.db.personaProfile.findUnique({ where: { id: 'me' } });
      const r = await suggestTopics({ store: createPrismaStore(ctx.db), llm: llmOrThrow(), personaText: formatPersona(persona as PersonaLike | null), myTopTitles: await loadMyTopTitles(ctx.db), now: ctx.now });
      if (!r.ok) throw new CliError('failed', r.reason);
      return r.topics;
    },
    format: (d) =>
      (d as { topic: string; why: string; hook: string; sources: { id: string; author: string; ratio: number | null }[] }[])
        .map((t, i) => `${i + 1}. ${t.topic}\n   为什么：${t.why}\n   开头：${t.hook}\n   参考：${t.sources.map((s) => `[${s.id}] ${s.author}（${s.ratio ?? '?'} 倍）`).join('、')}`)
        .join('\n'),
  },
  {
    path: ['project', 'show'],
    tier: 'read',
    hermes: true,
    usage: 'mp project show <项目>',
    summary: '项目的稿子、时长、阶段',
    async run(ctx, p) {
      const id = needArg(p, 0, '项目');
      const proj = await ctx.db.project.findUnique({ where: { id } });
      if (!proj) throw new CliError('not_found', '找不到这个项目（id 从 mp project list 里取）。');
      const s = ScriptSchema.safeParse(proj.script);
      const report = s.success ? checkDuration(s.data, proj.targetSec) : null;
      const t = await loadCurrentTranscript(ctx.db, id);
      return {
        id,
        title: proj.title,
        stage: proj.stage,
        targetSec: proj.targetSec,
        totalSec: report?.totalSec ?? null,
        durationOk: report?.ok ?? null,
        segments: s.success ? s.data.segments.map((x) => ({ id: x.id, role: ROLE_LABEL[x.role], text: x.text })) : [],
        transcriptLines: t ? t.data.lines.length : 0,
      };
    },
    format(d) {
      const x = d as { title: string; stage: string; targetSec: number; totalSec: number | null; durationOk: boolean | null; segments: { role: string; text: string }[]; transcriptLines: number };
      return [
        `${x.title} · ${x.stage} · ${x.totalSec === null ? '还没有稿子' : `约 ${x.totalSec} 秒 / 目标 ${x.targetSec} 秒${x.durationOk ? '' : '（时长没达标，看各段）'}`}`,
        ...x.segments.map((s) => `【${s.role}】${s.text}`),
        x.transcriptLines ? `已转写 ${x.transcriptLines} 句` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    path: ['publish', 'candidates'],
    tier: 'read',
    hermes: true,
    usage: 'mp publish candidates',
    summary: '等确认的作品关联',
    async run(ctx) {
      const out = [];
      for (const p of await ctx.db.project.findMany({ where: { stage: 'final' }, select: { id: true, title: true } })) {
        const c = await findCandidate(ctx.db, p.id);
        if (c) out.push({ projectId: p.id, projectTitle: p.title, ...c });
      }
      return out;
    },
    format: (d) =>
      (d as { projectId: string; projectTitle: string; workId: string; text: string }[]).map((c) => `项目 [${c.projectId}] ${c.projectTitle} ← 作品 [${c.workId}] ${c.text.slice(0, 30)}`).join('\n') || '没有等确认的作品关联。',
  },
  {
    path: ['retro', 'show'],
    tier: 'read',
    hermes: true,
    usage: 'mp retro show <项目>',
    summary: '看复盘',
    async run(ctx, p) {
      const s = await loadPublishState(ctx.db, needArg(p, 0, '项目'));
      if (!s) throw new CliError('not_found', '找不到这个项目。');
      return s;
    },
    format: (d) => formatRetro(d as PublishState),
  },
  {
    path: ['lessons', 'list'],
    tier: 'read',
    hermes: true,
    usage: 'mp lessons list',
    summary: '写法经验',
    async run(ctx) {
      const rows = await ctx.db.writingLesson.findMany({ where: { status: { not: 'rejected' } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
      return rows.map(toLessonView);
    },
    format: (d) =>
      (d as { id: string; text: string; status: string; evidenceCount: number }[])
        .map((l) => `[${l.id}] ${l.text}（${l.status === 'active' ? '生效' : l.status === 'candidate' ? '待你决定' : '已停用'} · ${l.evidenceCount} 条作品）`)
        .join('\n') || '还没有写法经验。',
  },
  {
    path: ['tasks', 'status'],
    tier: 'read',
    hermes: true,
    usage: 'mp tasks status',
    summary: '每晚任务状态',
    async run(ctx) {
      const d = createTaskDeps();
      const st = { collect: await readCollectStatus(ctx.now), scan: await readScanStatus(ctx.now) };
      const out = [];
      for (const key of Object.keys(NIGHTLY_TASKS) as TaskKey[]) {
        out.push({ key, label: NIGHTLY_TASKS[key].label, schedule: await getSchedule(d, key), running: await isTaskRunning(d, key), status: taskLine(st[key]), manualLeft: await manualRunsLeft(d, key) });
      }
      return out;
    },
    format: (d) =>
      (d as { label: string; schedule: { enabled: boolean; hour: number; minute: number }; running: boolean; status: string; manualLeft: number }[])
        .map((t) => `${t.label}：${t.running ? '正在跑' : t.status} · ${t.schedule.enabled ? `每晚 ${String(t.schedule.hour).padStart(2, '0')}:${String(t.schedule.minute).padStart(2, '0')}` : '定时未开'} · 今天还能手动 ${t.manualLeft} 次`)
        .join('\n'),
  },
];
