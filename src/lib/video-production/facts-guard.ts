import type { ScriptAct } from '@/lib/script/six-act';

/**
 * 画面层的事实护栏(二十一期)。
 *
 * 真实出片走查暴露的问题: 写稿层的「科普严谨性」约束(不说没把握的数字)只作用到台词,
 * Director/Builder 拿到的仅是一份 SRT, 既不知道哪些数字有出处、也不知道哪些表述是不能
 * 坐实的。结果模型为了把画面填满, 会**把台词里的模糊表述具体化成假数字**——实测一条
 * DeepSeek 涨价的片子里, Builder 自己编出「DeepSeek ¥10 / GPT-4o $20」的对比表并打勾,
 * 两个数字素材里都没有, 还混了货币口径。
 *
 * 危险性比写稿层的含糊更高: 台词里说「好几倍」观众听得出是估计, 表格里写「¥10」观众
 * 默认是查证过的。所以把六幕稿的 facts 台账(claim/value/source/confidence)一并喂给
 * 画面层, 并明确规定只有 high 把握的条目才允许被具象化。
 *
 * 传空数组(取不到六幕稿的老任务)时返回空串, 上游 prompt 与改动前字符级一致。
 *
 * `mode` 参数(二十六期新增): 这个函数现在被**新旧两条链共用**——旧链(模型自由写 HTML,
 * `director-prompt.ts`/`builder-prompt.ts`)和新链(填槽, `shot-plan.ts` 的固定卡片库)。
 * 旧链的"构图契约"讲的是自由排版(evidence/relation/volume 三种版面, volume 要求
 * "条目数不少于 8 条"), 这段话是二十一期为"画面太空"写的, 但新链的 `list` 卡片
 * schema 是 `items` 3~8 条、且卡片是固定版面——**同一段文案在新链里变成了"提示词
 * 要求不少于 8 条, schema 上限是 8"的自相矛盾指令**。实测(见 spike-builder-filmplan.md)
 * 三条真实稿子的 list 卡都真的在凑数(电池稿 6 条里 4 条编造)——这不是模型学坏了,
 * 是系统在指令层面制造了这个失败。
 *
 * 所以默认值 `'freeform'` 保持现状字符级不变(旧调用方一个字都不用改), 新增
 * `'cards'` 模式把"构图契约"和"画面填充优先级"里跟固定卡片冲突的措辞换掉, 换成
 * "list 条目必须有出处, 凑不满 3 条就改用 statement"这类与卡片库一致的规则。
 */
export type FactsSectionMode = 'freeform' | 'cards';

export function buildFactsSection(
  acts: ScriptAct[],
  brief?: { points: Array<{ fact: string; source: string; usage?: string }> } | null,
  mode: FactsSectionMode = 'freeform',
): string {
  if (acts.length === 0) return '';

  const solid = acts.flatMap((a) => a.facts ?? []).filter((f) => f.confidence === 'high');
  const briefPoints = brief?.points ?? [];

  const entries = [
    ...solid.map((f) => `- ${f.claim}: ${f.value}(来源: ${f.source})`),
    // 研究简报的事实点本身就是"带出处的真实文字", 是画面最好的填充料
    ...briefPoints.map((p) => `- ${p.fact}(来源: ${p.source})`),
  ];

  // 构图契约(或填槽纪律)只在**真有料可铺**时给 —— 没素材还压密度, 模型只会靠编来填满画面,
  // 那正是事实护栏要防的事。两者必须联动, 不能各说各话。(这条判断沿用上一版)
  const freeformLayoutBlock = `

构图契约(按这一镜的 visualJob 选一种, 不要每镜都用居中大字):
- **evidence**(对应 prove): 把一份真材料放成画面主体(占一半以上面积), 文字退成压在旁边的注解。没有第二个信息区。
- **relation**(对应 compare / reveal): 左区 + 中间连接符 + 右区。**连接符不能省** —— 它才是把两组东西连成一个论断的东西; 少了它就只是两张卡并排摆着。连接符画的是**镜头 claim 本身**说的那层关系(A 变成 B、A 对比 B), 不是从上面事实清单里推出来的因果, 后者仍然被下面的事实纪律禁止。
- **volume**(对应 clarify): 一份真实条目清单铺成一到两栏, 条目数不少于 8 条。**允许密** —— 密本身就是内容, 用体量说明"有多少"。

三种都不合适时就用单区块, 但**不要把一句话放大居中当作构图** —— 画面的框架(章节、编号、字幕、底纹)由渲染层统一提供, 你不需要也不应该自己画这些, 空的地方留空即可。`;

  const cardsLayoutBlock = `

选卡与填槽纪律(与卡片库配合使用, 不是自由排版):
- **每张卡的版面是固定的**, 你不用也不应该靠"塞更多条目"把画面撑满——密度不是这里的目标, 真实是。
- **list 卡的每一条 item 必须能在上面的事实清单里找到出处, 或者是稿子原文明确写到的内容**——不许为了凑够条目数量而编造场景/数据。**凑不满 3 条(items 下限)就换用 statement**, 宁可用一句真话, 也不要用编出来的第四条。
- 素材天然稀薄的一镜, 直接选 statement 或 contrast, 不要因为"想让画面显得饱满"就打肿 list。`;

  const layoutBlock = entries.length >= 2
    ? (mode === 'cards' ? cardsLayoutBlock : freeformLayoutBlock)
    : '';

  const ledger = entries.length > 0
    ? entries.join('\n')
    : '(空 —— 本条内容没有任何经得起坐实的数字, 画面上不许出现数字)';

  const freeformFillPriority = `
- 一屏可以放多块信息(清单 + 出处 + 小标题), 靠留白、圆角卡、分栏做层次; 不要一屏只放一句话。`;

  const cardsFillPriority = `
- **版面密度不由你决定** —— 卡片的留白、分栏、层次由渲染层的固定组件保证, 你只负责选对卡片类型、填对槽位里的文字, 不要为了让画面"看起来饱满"去加条目或加字。`;

  return `

可以坐实的事实清单(**只有**下列条目允许在画面上做成数字/图表/对比):
${ledger}

画面事实纪律(违反即返工):
- 清单之外的任何数字、比例、价格、排名、份额, 一律不许出现在画面上——包括表格、对比条、进度条、计分板、带单位的标签。
- 台词里的模糊表述(如"好几倍""便宜很多""大幅上涨")在画面上**保持模糊**, 用相对大小的形状或箭头示意即可, 不许具体化成数字。
- 不许把不同口径的量放进同一张对比表(不同货币、不同单位、不同时间口径), 混口径的对比比没有对比更误导。
- 素材里没有明确因果关系的, 不许做成箭头图/流程图/因果链这类断言式图形。
- 拿不准时, 用文字卡片复述台词, 不要自己补充信息。

画面填充优先级(参考视频拆解 §2.1 的核心结论):
- **优先把上面清单里的真实文字直接铺到画面上** —— 做成带出处的清单、卡片组、引用块、对照表都可以。观众信的是"这人真查过", 不是"这人会画图"。
- 抽象图形(色块、没有数据的折线图、空标签、装饰性图标)只在实在没有真实文字可铺时才用, **不要拿它们撑场面**。一个没有数据的图表比没有图表更糟。${mode === 'cards' ? cardsFillPriority : freeformFillPriority}

${layoutBlock}`;
}
