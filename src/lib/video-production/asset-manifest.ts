import path from 'path';

/** 内容素材根目录 —— 与 VIDEO_PRODUCTION_ROOT / VIDEO_TEMPLATE_ROOT 同一范式。
 * 放这里而不是路由文件里: Next.js 的 route.ts 只允许导出路由处理函数, 导出别的会编译报错。 */
export function contentAssetDir(contentId: string): string {
  return path.join(process.env.CONTENT_ASSET_ROOT || './content-assets', contentId);
}

export type AssetKind = 'image' | 'table' | 'text';

export interface ContentAsset {
  id: string;
  kind: AssetKind;
  /** 用户上传时写的一句话说明 —— Builder 靠它判断该在哪一镜用这份素材。 */
  description: string;
  /** 图片素材的文件名(渲染时会被拷进镜头 workDir, HTML 里用相对路径引用)。 */
  fileName: string | null;
  /** 表格/长文素材的原始内容。 */
  text: string | null;
}

/** 单条文字素材喂进 prompt 的上限 —— 再长就截断, 避免几份素材把 prompt 撑爆。 */
const MAX_TEXT_LEN = 600;

/**
 * 真实素材清单(二十一期方向 B)。
 *
 * 为什么必须有这个: 参考视频拆解发现, 它们画面里密度最高、最有说服力的那几帧,
 * 靠的是**整块真实截图**(真实目录、真实对话、带勾选的真实表格), 不是排版技巧。
 * 我们试过用提示词压排版、换更强模型, 都到不了那个量级 —— 因为纯文字排版结构上
 * 就达不到(参考视频自己的纯文字帧也只有 5% 左右)。要有那种实感, 只能把真实素材
 * 喂进去。
 *
 * 素材挂在**内容**上而不是模板上: 每条片子的真实素材都不一样, 挂模板会变成
 * 每条视频都塞同一批图。
 *
 * 空数组时返回空串, 上游 prompt 与改动前字符级一致。
 */
export function buildAssetSection(assets: ContentAsset[]): string {
  if (assets.length === 0) return '';

  const lines = assets.map((a, i) => {
    const head = `${i + 1}. 【${labelOf(a.kind)}】${a.description}`;
    if (a.kind === 'image') {
      // 相对路径: 渲染前素材会被拷到镜头 workDir 下(与 gsap.min.js 同级),
      // 写绝对路径在别的机器上就失效了
      return `${head}\n   用法: <img src="${a.fileName}"> —— 文件已放在同目录, 直接这样引用即可。`;
    }
    return `${head}\n   内容:\n${indent(truncate(a.text ?? ''))}`;
  });

  return `

可用的真实素材(本条内容专属, 已随镜头一起放好):
${lines.join('\n')}

素材使用规则:
- **优先用这些真实素材**填充画面, 而不是另画抽象图形 —— 真实截图/真实表格/真实目录的说服力
  是自造图形给不了的, 观众看的是"这人真做过", 不是"这人会画图"。
- 图片直接用 <img> 铺进版面(可以配小标题、圈注、说明文字), 表格与长文渲染成真正的表格/清单,
  不要只写个摘要或者用几个词概括。
- **只在内容对得上的镜头里用**: 素材的说明写清了它是什么, 与这一镜讲的东西无关就不要硬塞,
  宁可不用。同一份素材不必每镜都出现。`;
}

function labelOf(kind: AssetKind): string {
  return kind === 'image' ? '截图' : kind === 'table' ? '表格' : '长文';
}

function truncate(s: string): string {
  const t = s.trim();
  return t.length <= MAX_TEXT_LEN ? t : `${t.slice(0, MAX_TEXT_LEN)}…(后续内容已截断)`;
}

function indent(s: string): string {
  return s.split('\n').map((l) => `   ${l}`).join('\n');
}

/**
 * 给**导演**看的素材清单(二十一期方向 B 第二版)。
 *
 * 第一版只把素材给了 Builder, 结果实测 4 镜里 0 镜用上 —— 根因是导演排分镜时
 * 根本不知道有这些素材, 排不出"展示这张价格表"的镜头; Builder 只能在既定镜头里
 * 见缝插针, 而镜头本身没给素材留位置。所以改成: 导演先看到素材, 主动为它们排镜头
 * 并在 assetIds 里指派, Builder 收到的是**指派**而不是"可选清单"。
 */
export function buildDirectorAssetSection(assets: ContentAsset[]): string {
  if (assets.length === 0) return '';

  const list = assets
    .map((a) => `- id: ${a.id} 【${labelOf(a.kind)}】${a.description}`)
    .join('\n');

  return `

本条内容有以下**真实素材**可用(用户自己提供的一手材料):
${list}

素材排镜要求:
- **为这些素材专门安排镜头**: 讲到相关内容时, 排一个以该素材为画面主体的镜头, 而不是
  让它挤在别的镜头角落。真实截图/表格的说服力远高于自造图形, 观众看的是"这人真做过"。
- 在那一镜的 \`assetIds\` 字段里填上素材 id(数组, 可多份), 没用到素材的镜头不填或填空数组。
- 一份素材可以在多个镜头复用(比如先整体展示、再局部放大), 但不要每镜都塞。
- 素材是画面骨干, 不是装饰 —— 用到素材的那一镜, 时长可以给足一点让观众看清。`;
}

/**
 * 给 **Builder** 的指派素材(只含导演在这一镜点名要用的那几份)。
 *
 * 与 `buildAssetSection` 的区别: 那个是"这些都能用"(第一版, 实测模型会全部跳过),
 * 这个是"导演已经决定这一镜用它" —— 措辞是必须而非可以, 不给选择性执行留余地。
 */
export function buildAssignedAssetSection(
  all: ContentAsset[],
  assetIds: string[] | undefined,
): string {
  if (!assetIds || assetIds.length === 0) return '';
  const picked = all.filter((a) => assetIds.includes(a.id));
  if (picked.length === 0) return '';

  const lines = picked.map((a, i) => {
    const head = `${i + 1}. 【${labelOf(a.kind)}】${a.description}`;
    if (a.kind === 'image') {
      return `${head}\n   <img src="${a.fileName}"> —— 文件已在同目录, 直接这样引用。`;
    }
    return `${head}\n   内容:\n${indent(truncate(a.text ?? ''))}`;
  });

  return `

本镜头**必须**使用下列真实素材作为画面主体(导演已为这一镜指派):
${lines.join('\n')}

使用要求:
- 图片用 <img> 放在画面显著位置(建议占画面 40%~70%), 可以配小标题、圈注、说明文字。
- 表格/长文渲染成真正的表格或清单, 保留原始条目, 不要只写摘要或用几个词概括。
- 这是本镜的画面骨干, 不是点缀 —— 不要把它缩成角落里的小图标, 更不要略过不用。`;
}
