import 'dotenv/config';
import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { importWorks, type IncomingWork } from '../src/lib/works/import';
import { extractAwemeId, linkWorkByAwemeId } from '../src/lib/works/match';

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

const EGO = path.join(homedir(), '.local/bin/ego-browser');
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

/**
 * 把脚本喂给 `ego-browser nodejs` 并收集输出。
 *
 * 两个坑, 都踩过:
 * 1. **必须手动写 stdin**: `execFile` 的异步版本不支持 `input` 选项(那是
 *    execFileSync/spawnSync 的), 传了会被静默忽略, ego 一直等 stdin 直到超时。
 * 2. **`cliLog` 写的是 stderr 不是 stdout**。用 heredoc 手跑时两个流都打在终端上,
 *    完全看不出区别; 一旦分开管道接, 只读 stdout 就永远是空的。所以这里把两个流
 *    合起来找结果标记。
 */
function runEgo(script: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(EGO, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`超时 ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // cliLog 走 stderr, 结果标记也在里面 —— 两个流合起来给调用方
      if (code === 0) resolve(`${out}\n${err}`);
      else reject(new Error(`退出码 ${code}\n${err.slice(0, 600)}`));
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

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
    const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!user) {
      log('库里没有用户, 无法归属数据');
      process.exit(1);
    }
    const r = await importWorks(prisma, user.id, PLATFORM, works);
    const publicCount = works.filter((w) => !w.isPrivate).length;
    log(`回采完成: 共 ${r.total} 条(新增 ${r.created} / 更新 ${r.updated}), 其中公开 ${publicCount} 条`);

    /*
     * 回采之后补一次「登记过的发布 → 回采作品」的关联。
     *
     * 常见时序是**先发布登记, 后回采**: 你发完片子马上贴链接, 而那条作品要等
     * 今晚这一轮才进库。登记那一刻匹配不上, 只能在这里补。
     */
    const linked = await backfillLinks(prisma, user.id);
    if (linked > 0) log(`补上 ${linked} 条「作品 ← 稿子」的关联`);

    // 投稿分析 —— 失败不影响主回采(上面的数据已经落库了), 但要吵出来
    try {
      const n = await collectAnalytics(prisma, user.id);
      log(`投稿分析: 账号级 1 条快照, 逐条作品 ${n} 条`);
    } catch (e) {
      log(`投稿分析抓取失败(不影响作品列表): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 逐日指标 + 热搜榜 —— 同样各自独立失败
    try {
      const r = await collectHome(prisma, user.id);
      log(`账号趋势: ${r.metrics} 个指标 × ${r.days} 天; 热搜榜 ${r.topics} 条`);
    } catch (e) {
      log(`首页数据抓取失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 抓投稿分析并落库。
 *
 * 窗口是页面默认的近 90 天, 不是我们挑的 —— 见 ANALYTICS_SCRIPT 的注释。窗口外
 * 的老作品拿不到这组指标, 那就让它空着。
 */
async function collectAnalytics(prisma: PrismaClient, userId: string): Promise<number> {
  const end = new Date();
  // 页面默认窗口是近 90 天 —— 我们没法改它, 只能如实记下这个快照覆盖的是哪一段
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  const raw = await runEgo(ANALYTICS_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到分析结果');
  const data = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  const ov = data.overview ?? {};
  const num = (k: string): number => Number(ov[k]?.metric_value ?? 0);
  const windowStart = start.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);

  await prisma.douyinOverviewSnapshot.upsert({
    where: { userId_windowStart_windowEnd: { userId, windowStart, windowEnd } },
    update: {
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
      fetchedAt: new Date(),
    },
    create: {
      userId, windowStart, windowEnd,
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
    },
  });

  // 逐条作品的分析指标, 按 externalId 打到已有的作品行上 —— 只更新分析那一组
  // 字段, 不碰列表接口来的 play/digg(两组数字本来就不一样, 互相覆盖会更乱)
  const items: unknown[] = Array.isArray(data.items?.items) ? data.items.items : [];
  let n = 0;
  for (const it of items as Record<string, unknown>[]) {
    const externalId = String(it.item_id ?? '');
    if (!externalId) continue;
    const r = await prisma.publishedWork.updateMany({
      where: { userId, externalId },
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

/**
 * 抓逐日指标与热搜榜并落库。
 *
 * 逐日指标按 (指标, 日期) upsert —— 接口只回 7 天, 但每晚跑一次就能自己攒长历史。
 * 热搜按 billboardId upsert 并维护 firstSeenAt/peakHotValue: 「热了多久、峰值多高」
 * 比「此刻多热」有用得多。
 */
async function collectHome(
  prisma: PrismaClient,
  userId: string,
): Promise<{ metrics: number; days: number; topics: number }> {
  const raw = await runEgo(HOME_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到首页数据');
  const home = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  let metrics = 0;
  let days = 0;
  for (const [metric, v] of Object.entries((home.daily?.data ?? {}) as Record<string, unknown>)) {
    const row = v as {
      option_list?: { count?: string; date?: string }[];
      current_count?: string;
      last_period_incr?: string;
    };
    const series = row.option_list ?? [];
    if (series.length === 0) continue;
    metrics++;

    // 当前值/环比和日序列对不上(fans 当前 2765、日序列 395), 平台没说明各自定义
    // —— 单独存, 不换算也不挑一个。
    const currentCount = Number(row.current_count ?? 0);
    const lastPeriodIncr = Number(row.last_period_incr ?? 0);
    await prisma.douyinMetricSummary.upsert({
      where: { userId_metric: { userId, metric } },
      update: { currentCount, lastPeriodIncr, fetchedAt: new Date() },
      create: { userId, metric, currentCount, lastPeriodIncr },
    });
    for (const p of series) {
      const date = String(p.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const count = Number(p.count ?? 0);
      await prisma.douyinDailyMetric.upsert({
        where: { userId_metric_date: { userId, metric, date } },
        update: { count, fetchedAt: new Date() },
        create: { userId, metric, date, count },
      });
      days++;
    }
  }

  let topics = 0;
  const elements = (home.billboard?.billboard_data?.element_list ?? []) as Record<string, unknown>[];
  for (const el of elements) {
    const base = (el.base_data ?? {}) as Record<string, unknown>;
    const billboardId = String(base.billboard_id ?? '');
    const title = String(base.title ?? '').trim();
    if (!billboardId || !title) continue;
    const hotValue = Number((el.statistics_data as { hot_value?: string })?.hot_value ?? 0);
    const related: string[] = ((el.related_item_list ?? []) as { sec_item_id?: string }[])
      .map((r) => r.sec_item_id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0);

    const existing = await prisma.douyinHotTopic.findUnique({
      where: { userId_billboardId: { userId, billboardId } },
      select: { peakHotValue: true },
    });
    await prisma.douyinHotTopic.upsert({
      where: { userId_billboardId: { userId, billboardId } },
      update: {
        title,
        hotValue,
        peakHotValue: Math.max(hotValue, existing?.peakHotValue ?? 0),
        relatedItemIds: related,
        lastSeenAt: new Date(),
      },
      create: {
        userId, billboardId, title,
        board: String(base.author ?? ''),
        hotValue, peakHotValue: hotValue,
        relatedItemIds: related,
      },
    });
    topics++;
  }

  return { metrics, days, topics };
}

/**
 * 把登记过的发布链接和回采作品对上。
 *
 * 只处理还没关联的作品 —— 人手动认领过的判断不该被自动匹配覆盖。
 */
async function backfillLinks(prisma: PrismaClient, userId: string): Promise<number> {
  const dists = await prisma.distribution.findMany({
    where: { platform: PLATFORM },
    select: { url: true, scriptDraftId: true },
  });
  let linked = 0;
  for (const d of dists) {
    const awemeId = extractAwemeId(d.url);
    if (!awemeId) continue;
    const r = await linkWorkByAwemeId(prisma, userId, awemeId, d.scriptDraftId);
    if (r === 'linked') linked++;
  }
  return linked;
}

main().catch((e) => {
  log(`未预期的错误: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
