/**
 * 空内容守卫(二十五期)。
 *
 * 背景: `shot-plan.ts` 里字符串槽位用的是 `min(1)`、**不 trim**——纯空白字符串
 * (如 `'   '`)能通过 schema 校验。这个项目出过真实事故: 一个整整 23 秒、
 * 100% 纯空白的镜头一路进了成片, 而日志上"零失败"。
 *
 * 这里选择**显式抛错**而不是"渲染一个显眼占位提示": 占位提示仍然要靠人去
 * 肉眼扫一遍成片才能发现, 而这条产线上一次真实事故恰恰证明"指望有人盯帧"
 * 是会失手的。抛错会让 `renderMedia` 直接失败、退出码非零、日志里见得到
 * 堆栈 —— 这样"缺内容"这件事在渲染阶段就拦下来, 不必等到有人打开成片。
 * 唯一代价是坏一镜可能拖累整条片子的渲染, 但这正是我们想要的: 宁可这条
 * 片子渲不出来, 也不让空白悄悄混进成片。
 */
export function assertContent(value: string | undefined | null, field: string): string {
  if (value === undefined || value === null || value.trim().length === 0) {
    throw new Error(
      `[卡片槽位为空] 字段 "${field}" 是空白或缺失 —— schema 的 min(1) 不 trim, ` +
        '拦不住纯空白字符串。为了不让空白悄悄进成片, 这里显式中断渲染。',
    );
  }
  return value;
}
