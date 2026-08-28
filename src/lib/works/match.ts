/**
 * 把「我发出去的这条」和「回采回来的那条」对上(二十三期)。
 *
 * 校准要的是「预测分 vs 实际表现」的配对, 而平台不会告诉系统哪条作品是用哪份稿子
 * 发的。手动认领已经有了(数据页逐条选), 但那是每条都要做一次的活儿。
 *
 * 更省事的路子是**发布时贴一次链接**: 链接里带作品 id, 回采回来的作品也带同一个
 * id, 两边一对就自动关联上了。
 *
 * 抽 id 这件事有个坑: 抖音分享链接里**同时有两个 19 位数字** —— 路径上的作品 id
 * 和查询参数里的 `mid`(那是另一个东西)。只扫「第一串 19 位数字」会抓到哪个取决于
 * 顺序, 抓错了就关联到别人的作品上去了。所以只认路径段。
 */

/** 抖音作品 id 是 19 位数字。给一点余量, 但不能松到把 `/video/123` 也认了。 */
const AWEME_ID = /^\d{16,21}$/;

/**
 * 从链接里抽作品 id。抽不出来返回 null —— 短链(v.douyin.com/xxx)要跳转才知道是
 * 哪条, 猜一个不如老实说不知道。
 */
export function extractAwemeId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (raw.length === 0) return null;

  // 从后台直接复制出来的常常就是一串纯 id
  if (AWEME_ID.test(raw)) return raw;

  let pathname: string;
  try {
    pathname = new URL(raw.includes('://') ? raw : `https://${raw}`).pathname;
  } catch {
    return null;
  }

  // 只看路径段, 不看查询参数 —— mid 也是 19 位数字, 混进来就会认错作品
  for (const seg of pathname.split('/')) {
    if (AWEME_ID.test(seg)) return seg;
  }
  return null;
}

/**
 * 按作品 id 把一份稿子关联到已回采的作品上。
 *
 * 返回是否真的关联上了 —— 调用方要如实告诉用户「已自动关联」还是「等今晚回采」,
 * 两者的后续动作不一样(后者要等, 前者可以直接去看校准)。
 *
 * **不覆盖已有的关联**: 一条作品已经认领过一份稿子时保持原样。自动匹配是便利,
 * 不该悄悄改掉人手动做过的判断。
 */
export async function linkWorkByAwemeId(
  db: {
    publishedWork: {
      findFirst(args: unknown): Promise<{ id: string; scriptDraftId: string | null } | null>;
      update(args: unknown): Promise<unknown>;
    };
  },
  userId: string,
  awemeId: string,
  scriptDraftId: string,
): Promise<'linked' | 'already-linked' | 'not-collected-yet'> {
  const work = await db.publishedWork.findFirst({
    where: { userId, externalId: awemeId },
    select: { id: true, scriptDraftId: true },
  });
  if (!work) return 'not-collected-yet';
  if (work.scriptDraftId) return 'already-linked';
  await db.publishedWork.update({ where: { id: work.id }, data: { scriptDraftId } });
  return 'linked';
}
