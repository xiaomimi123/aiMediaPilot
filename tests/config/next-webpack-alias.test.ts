import { describe, it, expect } from 'vitest';
import path from 'node:path';

/*
 * next.config.js 的 webpack alias 是三十二期让 Player 能渲染 remotion 子项目组件的
 * 关键配置 —— 主项目 React 18、remotion/ 子项目 React 19, 靠把三个裸导入都指向根
 * node_modules 才能共用同一份模块实例(否则 Player 的 Provider 包不住 Film 的
 * useVideoConfig, 报 "No video config found")。
 *
 * **这条测试守的是 alias key 末尾那个 `$`。** 不带 `$` 时 webpack 按前缀匹配,
 * 会把 `react-dom/server.edge` 这类子路径也一并重写、绕过 react-dom 的 exports
 * 条件导出 —— 实测后果是**全站 SSR 500**(不只剪辑台, 首页和成片页一起炸)。
 *
 * 为什么需要这条测试: 三十二期终审指出这个坑当时只有代码注释兜着。而且
 * **`next build` 抓不住它** —— 本项目所有路由都是动态渲染(build 输出全是 `ƒ`),
 * 构建期根本不执行 SSR, 要等真人点开页面才会发现。这是一个"改对 90% 反而更危险"
 * 的配置: 写对了 Player 能跑, 写成"差不多对"整个站点起不来。
 */
describe('next.config.js 的 webpack alias', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nextConfig = require(path.join(process.cwd(), 'next.config.js'));

  const aliasOf = (): Record<string, string> => {
    const config = { resolve: { alias: {} as Record<string, string> } };
    // Next 传给 webpack 回调的第二个参数(options)在这条配置里没被用到, 给个空对象即可
    const out = nextConfig.webpack(config, {});
    return out.resolve.alias;
  };

  it('三个裸导入都被指向根 node_modules', () => {
    const alias = aliasOf();
    for (const key of ['remotion$', 'react$', 'react-dom$']) {
      expect(alias[key], `${key} 必须在 alias 里`).toBeDefined();
      expect(alias[key]).toBe(path.join(process.cwd(), 'node_modules', key.replace('$', '')));
    }
  });

  it('每个 alias key 都以 $ 结尾 —— 少一个 $ 会让全站 SSR 500', () => {
    const alias = aliasOf();
    // 只检查本项目自己加的这三个(Next 内部也会往 alias 里塞东西, 那些不归我们管)
    for (const key of ['remotion', 'react', 'react-dom']) {
      expect(
        Object.prototype.hasOwnProperty.call(alias, `${key}$`),
        `alias 里应有 "${key}$"(精确匹配)而不是 "${key}"(前缀匹配) —— ` +
          '前缀匹配会连 react-dom/server.edge 等子路径一起重写, 绕过 exports 条件导出, 全站 SSR 500',
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(alias, key),
        `alias 里不该有裸的 "${key}"(前缀匹配)`,
      ).toBe(false);
    }
  });
});
