import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readResult, runEgo } from '../src/lib/ego';
import { parseSelfProfile, saveSelfProfile, SELF_PROFILE_SCRIPT } from '../src/lib/douyin/profile';
import { importWorks, type IncomingWork } from '../src/lib/works/import';

/**
 * 每晚定时回采抖音作品数据。
 *
 * 为什么是独立脚本 + launchd, 而不是应用内的队列任务:
 * 队列要 worker 在跑, 而 worker 是需要手动 `npm run worker:dev` 的 —— 这个项目
 * 已经因为它静默不跑吃过大亏(9 次出片 0 成功, 任务从晚上停到第二天)。这个脚本
 * 直接写库, 连 web server 都不需要开着。
 *
 * 依赖: ego lite(共享用户已登录的浏览器状态)。**全程只读**, 只 GET 作品列表接口。
 *
 * 失败一定要吵: 任何一步出错都 exit 1 并把原因写进日志, 绝不静默跳过 —— 静默失败
 * 意味着几周后你以为在回采其实早就停了, 而数据看起来「只是没更新」。
 */

const TASK_SPACE = '抖音作品数据回采';
const PLATFORM = 'douyin';

/** 在 ego-browser 里跑的抓取脚本。输出一行 JSON 到 stdout。 */
const FETCH_SCRIPT = `
await useOrCreateTaskSpace(${JSON.stringify(TASK_SPACE)})
await openOrReuseTab('https://creator.douyin.com/creator-micro/content/manage', { wait: true, timeout: 30 })

const byId = new Map()
let cursor = 0
for (let page = 0; page < 12; page++) {
  // 分页参数是 max_cursor 不是 cursor —— 用 cursor 会一直返回第一页
  const q = page === 0 ? 'cursor=0' : 'max_cursor=' + cursor
  const body = await browserFetch(
    'https://creator.douyin.com/web/api/media/aweme/post/?count=20&aid=2906&' + q,
    { method: 'GET' },
  )
  const d = typeof body === 'string' ? JSON.parse(body) : body
  const list = d.aweme_list ?? []
  const before = byId.size
  for (const a of list) {
    const s = a.statistics ?? {}
    const st = a.status ?? {}
    byId.set(a.aweme_id, {
      externalId: a.aweme_id,
      title: (a.item_title || a.desc || '').slice(0, 200),
      caption: a.desc ?? '',
      hashtags: (a.text_extra ?? []).map((t) => t.hashtag_name).filter(Boolean),
      isPrivate: !!(st.is_private || st.self_see),
      url: a.share_url ?? '',
      createTime: a.create_time,
      durationSec: Math.round((a.duration ?? 0) / 1000),
      play: s.play_count ?? 0, digg: s.digg_count ?? 0, comment: s.comment_count ?? 0,
      collect: s.collect_count ?? 0, share: s.share_count ?? 0,
    })
  }
  if (!d.has_more || byId.size === before) break
  cursor = d.max_cursor
  await wait(1)
}
cliLog('@@RESULT@@' + JSON.stringify([...byId.values()]))
`;

/**
 * 抓「投稿分析」。和上面的作品列表是**两个不同的接口**, 数字对不上:
 * 同一条作品列表报 223,960 播, 分析报 4,985 播。抖音没说哪个是曝光哪个是有效
 * 播放, 所以两组都存、各自标明来源, 不挑一个当真相。
 *
 * 这三条接口是从真实页面的 XHR 里抓出来的(猜路径全部 404)。
 *
 * **不能像作品列表那样直接 browserFetch**: 这几条要签名参数(msToken/a_bogus),
 * 少了就静默返回空对象 —— 不是报错, 是一组全 0 的数, 比报错更坑。所以让页面
 * 自己去请求, 我们在 XHR 上打补丁接住响应。
 *
 * 代价是**窗口只能是页面的默认值(近 90 天)**: 改窗口要去驱动页面上的日期选择器,
 * 那是另一种脆弱。窗口外的老作品没有这组指标, 页面上如实标「没有分析数据」,
 * 不拿列表接口的数去顶。
 */
const ANALYTICS_SCRIPT = `
await useOrCreateTaskSpace(${JSON.stringify(TASK_SPACE)})
await openOrReuseTab('https://creator.douyin.com/creator-micro/data-center/content', { wait: true, timeout: 30 })

// 在新文档加载前打补丁 —— 导航会清掉页面里的一切, 事后注入抓不到首屏那几个请求
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: \`
    window.__cap = {};
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) {
      this.__u = String(u);
      if (this.__u.includes('item_analysis')) {
        this.addEventListener('load', () => {
          try {
            const key = this.__u.includes('overview') ? 'overview'
              : this.__u.includes('item_performance') ? 'items'
              : this.__u.includes('involved_vertical') ? 'vertical' : null;
            if (key) window.__cap[key] = JSON.parse(this.responseText);
          } catch (e) {}
        });
      }
      return oo.call(this, m, u, ...r);
    };
  \`,
})

await gotoAndWait('https://creator.douyin.com/creator-micro/data-center/content', { timeout: 30 })
await wait(14)
const cap = await js('JSON.stringify(window.__cap || {})')
cliLog('@@RESULT@@' + (typeof cap === 'string' ? cap : JSON.stringify(cap)))
`;

/**
 * 抓账号首页的两组数据: 逐日指标 + 热搜榜。
 *
 * 走首页而不是数据中心 —— 这两条接口只在 `creator-micro/home` 上发。同样必须让
 * 页面自己请求(要签名参数), 我们在 XHR/fetch 上打补丁接住。
 *
 * **先去别的页再进首页**: `addScriptToEvaluateOnNewDocument` 只对新文档生效,
 * 如果当前已经停在首页, 再 goto 一次同一个 URL 不会重新加载文档, 补丁就白打了。
 */
const HOME_SCRIPT = `
await useOrCreateTaskSpace(${JSON.stringify(TASK_SPACE)})
await openOrReuseTab('https://creator.douyin.com/creator-micro/content/manage', { wait: true, timeout: 30 })

await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: \`
    window.__home = {};
    const grab = (u, t) => {
      try {
        if (u.includes('overview/all')) window.__home.daily = JSON.parse(t);
        else if (u.includes('overview/billboard')) window.__home.billboard = JSON.parse(t);
      } catch (e) {}
    };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) {
      this.__u = String(u);
      if (this.__u.includes('overview/all') || this.__u.includes('overview/billboard')) {
        this.addEventListener('load', () => grab(this.__u, this.responseText));
      }
      return oo.call(this, m, u, ...r);
    };
    const of = window.fetch;
    window.fetch = async function (...a) {
      const u = String(a[0]?.url ?? a[0]);
      const res = await of.apply(this, a);
      if (u.includes('overview/all') || u.includes('overview/billboard')) { try { grab(u, await res.clone().text()) } catch (e) {} }
      return res;
    };
  \`,
})

await gotoAndWait('https://creator.douyin.com/creator-micro/content/manage', { timeout: 25 })
await wait(3)
await gotoAndWait('https://creator.douyin.com/creator-micro/home', { timeout: 25 })
await wait(12)
const home = await js('JSON.stringify(window.__home || {})')
cliLog('@@RESULT@@' + (typeof home === 'string' ? home : JSON.stringify(home)))
`;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  log('开始回采');

  let stdout: string;
  try {
    stdout = await runEgo(FETCH_SCRIPT);
  } catch (e) {
    log(`ego-browser 执行失败: ${e instanceof Error ? e.message.slice(0, 800) : String(e)}`);
    log('常见原因: ego lite 没在运行, 或抖音登录态已过期 —— 打开 ego lite 重新登录一次。');
    process.exit(1);
  }

  const marker = stdout.indexOf('@@RESULT@@');
  if (marker < 0) {
    log('没拿到结果标记, ego-browser 的输出是:');
    log(stdout.slice(0, 1000));
    process.exit(1);
  }

  let works: IncomingWork[];
  try {
    works = JSON.parse(stdout.slice(marker + '@@RESULT@@'.length).split('\n')[0]);
  } catch (e) {
    log(`结果不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // 一条都没抓到八成是登录态掉了, 而不是账号真的没作品 —— 这时候写库会把已有数据
  // 的 fetchedAt 白白刷新, 让人以为回采是成功的
  if (works.length === 0) {
    log('抓到 0 条作品, 判定为异常(登录态失效?), 不写库');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const r = await importWorks(prisma, PLATFORM, works);
    const publicCount = works.filter((w) => !w.isPrivate).length;
    log(`回采完成: 共 ${r.total} 条(新增 ${r.created} / 更新 ${r.updated}), 其中公开 ${publicCount} 条`);

    // 投稿分析 —— 失败不影响主回采(上面的数据已经落库了), 但要吵出来
    try {
      const n = await collectAnalytics(prisma);
      log(`投稿分析: 账号级 1 条快照, 逐条作品 ${n} 条`);
    } catch (e) {
      log(`投稿分析抓取失败(不影响作品列表): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 粉丝/获赞/作品数(「我的资料」, 与主页一致) —— 独立失败
    try {
      const r = readResult(await runEgo(SELF_PROFILE_SCRIPT)) as { status: number; body: string };
      const p = parseSelfProfile(JSON.parse(r.body));
      await saveSelfProfile(prisma, p);
      log(`账号资料: 粉丝 ${p.followers} / 获赞 ${p.totalLikes} / 作品 ${p.awemeCount}`);
    } catch (e) {
      log(`账号资料抓取失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 创作者后台数据概览(口径不明, 首页不再用它的 fans) —— 同样独立失败
    try {
      const m = await collectHome(prisma);
      log(`账号指标: ${m} 项`);
    } catch (e) {
      log(`首页数据抓取失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 抓投稿分析并落库。窗口是页面默认的近 90 天, 不是我们挑的。
 * 逐条作品的分析指标只更新分析那一组字段, 不碰列表接口来的 play/digg。
 */
async function collectAnalytics(prisma: PrismaClient): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  const raw = await runEgo(ANALYTICS_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到分析结果');
  const data = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  const ov = data.overview ?? {};
  const num = (k: string): number => Number(ov[k]?.metric_value ?? 0);
  const windowStart = start.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);
  const values = {
    submissionCount: num('submission_count'),
    medianPlay: num('median_play_count'),
    avgLike: num('average_like_count_per_video'),
    avgComment: num('average_comment_count_per_video'),
    avgShare: num('average_share_count_per_video'),
    avgPlayDurationSec: num('average_play_duration'),
    bounceRate2s: num('bounce_rate_2s'),
    completionRate5s: num('completion_rate_5s'),
    coverClickRate: num('cover_click_ratio'),
    verticals: data.vertical?.primary_verticals ?? [],
  };
  await prisma.douyinOverviewSnapshot.upsert({
    where: { windowStart_windowEnd: { windowStart, windowEnd } },
    update: { ...values, fetchedAt: new Date() },
    create: { windowStart, windowEnd, ...values },
  });

  const items: unknown[] = Array.isArray(data.items?.items) ? data.items.items : [];
  let n = 0;
  for (const it of items as Record<string, unknown>[]) {
    const externalId = String(it.item_id ?? '');
    if (!externalId) continue;
    const r = await prisma.publishedWork.updateMany({
      where: { platform: PLATFORM, externalId },
      data: {
        anaPlay: Number(it.play_count ?? 0),
        completionRate5s: Number(it.completion_rate_5s ?? 0),
        bounceRate2s: Number(it.bounce_rate_2s ?? 0),
        avgPlayDurationSec: Number(it.average_play_duration ?? 0),
        playPerClient: (it.play_count_per_client ?? {}) as object,
        analyticsFetchedAt: new Date(),
      },
    });
    n += r.count;
  }
  return n;
}

/** 抓账号级当前值(粉丝数等)。当前值与日序列口径对不上, 只存当前值与环比, 不换算。 */
async function collectHome(prisma: PrismaClient): Promise<number> {
  const raw = await runEgo(HOME_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到首页数据');
  const home = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  let metrics = 0;
  for (const [metric, v] of Object.entries((home.daily?.data ?? {}) as Record<string, unknown>)) {
    const row = v as { option_list?: unknown[]; current_count?: string; last_period_incr?: string };
    if ((row.option_list ?? []).length === 0) continue;
    const currentCount = Number(row.current_count ?? 0);
    const lastPeriodIncr = Number(row.last_period_incr ?? 0);
    await prisma.douyinMetricSummary.upsert({
      where: { metric },
      update: { currentCount, lastPeriodIncr, fetchedAt: new Date() },
      create: { metric, currentCount, lastPeriodIncr },
    });
    metrics++;
  }
  return metrics;
}

main().catch((e) => {
  log(`未预期的错误: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
