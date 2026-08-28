import 'dotenv/config';
import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`未预期的错误: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
