/**
 * 主导航(前端重建 · 阶段 3)。
 *
 * 只有三项。旧版侧栏六项(账号定位/灵感库选题/热点雷达/模板/成片/内容数据分析)
 * 里, 出片与复盘两条链路的真实产出是 0 —— 出片 9 次成片 0 次、指标 0 条。
 * 规则: **不给未验证的链路做界面**。出片链路验证通过后, 它以「稿子详情页里的
 * 一个按钮 + 一个状态条」的形态回归, 不新增顶层入口。
 *
 * 纯数据 + 纯函数放在 lib 里而不是组件里: 导航结构要能被测试, 而不是靠肉眼看
 * 侧栏渲染出几个来。
 */

export interface NavItem {
  href: string;
  label: string;
  /** 一句话说明这一栏是干什么的, 侧栏收起时作为 title 提示。 */
  hint: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/topics', label: '选题', hint: '灵感库与热点雷达, 挑一个开条' },
  { href: '/write', label: '写稿', hint: '把选题写成六幕口播稿' },
  { href: '/scripts', label: '稿库', hint: '你写过的稿子与它们的评分' },
];

export const SETTINGS_ITEM: NavItem = {
  href: '/settings',
  label: '设置',
  hint: '账号定位、个人经历、AI 与雷达配置',
};

const ALL = [...NAV_ITEMS, SETTINGS_ITEM];

/**
 * 当前路径归属哪一项(返回该项的 href, 没有则 null)。
 *
 * 按**路径段**比较而不是字符串前缀: `/writeup` 不该把「写稿」点亮。
 */
export function activeNavHref(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const first = `/${segments[0]}`;
  return ALL.some((i) => i.href === first) ? first : null;
}
