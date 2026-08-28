/**
 * 主导航(v5)。
 *
 * 12 项分三组。这不是十二个并列的功能, 而是**一条反馈回路**的三段:
 *
 * - 工作区 = 快回路(秒级): 选题 → 写稿 → 稿库 → 素材库
 * - 生产   = 把稿子变成片子: 模板 → 成片
 * - 分析   = 中/慢回路: 拆解 → 钩子库 → 校准 → 数据
 *
 * `ready` 标的是「这一栏依赖的数据链路通没通」。**不通的照样进导航, 但页面必须
 * 如实说明为什么是空的** —— 「不给未验证的链路做界面」指的是不做操作入口,
 * 不是把问题藏起来。成片 9 次 0 成功、指标 0 条这些事, 藏起来才是真的害人。
 *
 * 纯数据 + 纯函数放 lib 不放组件: 「侧栏有几项、哪一项该亮」要能被测试钉住。
 */

export interface NavItem {
  href: string;
  label: string;
  /** 一句话说明这一栏是干什么的。 */
  hint: string;
  /** 这一栏依赖的数据链路通了没有。false 的页面要给空态 + 原因。 */
  ready: boolean;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export const HOME_ITEM: NavItem = {
  href: '/',
  label: '总览',
  hint: '今天该做什么, 以及哪条链路断了',
  ready: true,
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: '工作区',
    items: [
      { href: '/topics', label: '选题', hint: '热点雷达与灵感库, 挑一个开条', ready: true },
      { href: '/write', label: '写稿', hint: '把选题写成六幕口播稿', ready: true },
      { href: '/scripts', label: '稿库', hint: '你写过的稿子与它们的评分', ready: true },
      { href: '/materials', label: '素材库', hint: '书摘、数据、亲身经历 —— 写稿时按幕检索', ready: false },
    ],
  },
  {
    label: '生产',
    items: [
      { href: '/templates', label: '模板', hint: '决定成片的画面结构、字幕与转场', ready: true },
      { href: '/films', label: '成片', hint: '出片队列与成片, 就地播放与确认导出', ready: true },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '/teardowns', label: '拆解', hint: '拆对标视频的结构、钩子与节奏', ready: false },
      { href: '/hooks', label: '钩子库', hint: '前 3 秒的写法, 按实际留存排序', ready: false },
      { href: '/calibration', label: '校准', hint: '预测分 vs 实际表现, 让评分变准', ready: false },
      { href: '/data', label: '数据', hint: '发布后回采曝光、互动与涨粉', ready: false },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const SETTINGS_ITEM: NavItem = {
  href: '/settings',
  label: '设置',
  hint: '账号定位、个人经历、AI 与雷达配置',
  ready: true,
};

const ALL = [HOME_ITEM, ...NAV_ITEMS, SETTINGS_ITEM];

/**
 * 当前路径归属哪一项(返回该项的 href, 没有则 null)。
 *
 * 按**路径段**比较而不是字符串前缀: `/writeup` 不该把「写稿」点亮。
 */
export function activeNavHref(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return HOME_ITEM.href;
  const first = `/${segments[0]}`;
  return ALL.some((i) => i.href === first) ? first : null;
}
