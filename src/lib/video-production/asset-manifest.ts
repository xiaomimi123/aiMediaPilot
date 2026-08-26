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
