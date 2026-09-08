import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { ensureShotStill, type ShotStillCacheOpts } from '@/lib/video-production/shot-still-cache';

/**
 * 剪辑台的 renderStill 卡面图接口(三十一期 Task 3)。
 *
 * `GET /api/v1/cockpit/video-productions/[id]/shot-still/[shotIndex]` 给
 * `FilmPlan.shots[shotIndex]` 渲一张静态卡面 PNG——`plan_ready` 停下之后, 剪辑台
 * UI(Task 4)横向展示每镜缩略图用。渲染/缓存/孤儿清理的实际逻辑在
 * `shot-still-cache.ts`(独立文件, 供真渲染测试脱离这层 Request/Response 直接调用),
 * 这里只做鉴权 + 取参数 + 拼 FilmInput 需要的上下文 + 读文件返回。
 */

/** 取模板。照 `film-plan/route.ts` 的 `templateOf` 同一先例, 独立写一份不跨路由
 * import(那个函数是路由文件里的模块私有辅助, 不是公共 lib)。 */
async function templateOf(templateId: string | null) {
  return templateId ? prisma.videoTemplate.findUnique({ where: { id: templateId } }) : null;
}

/** 渲染层 `visualStyle`——照抄 `film-plan/route.ts` 的 `visualStyleForMode` 同一
 * 判断(ppt-narration/talking-head-broll 传 'card', illustration-tts 传 'illustration')。 */
function visualStyleForMode(mode: string): 'card' | 'illustration' {
  return mode === 'illustration-tts' ? 'illustration' : 'card';
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string; shotIndex: string } },
) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  /*
   * status 不限制——不像 `film-plan` PUT 那样要求 `status === 'plan_ready'`。
   * 那个限制是"改方案只在停下来这一刻有意义"; 这里只是**看**一张卡面图, 任务
   * 渲染完(preview_ready/done)之后卡面依然是有效信息(将来详情页复用这个接口
   * 展示分镜缩略图), 没有理由拦掉。
   */

  const shots = (vp.filmPlan as { shots?: unknown[] } | null)?.shots;
  if (!Array.isArray(shots) || shots.length === 0) return fail('尚无分镜方案', 404);

  // shotIndex 必须是纯数字字符串——`parseInt('1abc')` 会静默取到 1, 用正则先拦掉
  // 这种"看似合法实则打错"的输入, 而不是让它意外落在合法范围内。
  if (!/^\d+$/.test(params.shotIndex)) return fail('镜号不合法', 404);
  const shotIndex = Number(params.shotIndex);
  if (shotIndex >= shots.length) return fail('镜号越界', 404);
  const shot = shots[shotIndex];

  const template = await templateOf(vp.templateId);
  // aspect 推导照抄 worker/film-plan 路由现状: 模板 aspect==='9:16' 才是竖屏。
  const aspect: '16:9' | '9:16' = template?.aspect === '9:16' ? '9:16' : '16:9';
  const visualStyle = visualStyleForMode(vp.mode);
  // 模板级默认样式(三十六期 Task 3)——照 worker/film-plan 路由同一写法, 让卡面
  // 预览与真实渲染出的画面一致。
  const templateStyle = (template?.defaultShotStyle as ShotStillCacheOpts['templateStyle']) ?? undefined;

  const stillsDir = path.join(vp.productionRoot, 'stills');
  const { filePath } = await ensureShotStill({ stillsDir, shotIndex, shot, aspect, visualStyle, templateStyle });

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    // 理论上不该发生(`ensureShotStill` 渲染成功才会返回路径)——防御性兜底。
    return fail('卡面渲染失败', 500);
  }

  // Buffer 是 Uint8Array 的子类, 运行时可以直接喂给 Response, 但 TS 的 DOM lib
  // 类型不认这层继承关系(`BodyInit` 拒绝 Node 的 Buffer 泛型)——转一层普通
  // Uint8Array 满足类型检查, 不改变实际字节。
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(buf.length),
    },
  });
}
