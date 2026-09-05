const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // playwright-core 含 .ttf/.html 资源, 让 Next 不 bundle, 运行时从 node_modules 加载.
    serverComponentsExternalPackages: ['@prisma/client', 'playwright-core', 'playwright'],
  },
  // 前端重建后这里清空了。
  //
  // 原来有四条重定向, 把 /agent /dashboard /settings 指向 `/?view=xxx` 的单页视图。
  // 那套单页外壳在阶段 1 连同旧前端一起删了, `?view=` 参数早已没人解析 —— 但重定向
  // 规则留着, 结果 /settings 被劫持到一个渲染不出设置页的首页, 而新的 /settings
  // 页面根本没机会被访问到。
  //
  // 教训: **删导航项时要连它的 redirect 一起删**。重定向是隐形的, 它不在任何组件里,
  // grep 组件名找不到它, 只有真的点进去才会发现。

  // 三十二期 Task 0(spike)——`remotion/` 是仓库内独立子项目, 自带一份 node_modules
  // (React 19 + remotion 4.0.399), 与主项目 (React 18.3.1) 各自独立。主项目要 import
  // `remotion/src/Film.tsx` 给 `@remotion/player` 用时, webpack 按"就近祖先目录"解析
  // 规则, 会把 `Film.tsx` 里的 `import ... from 'remotion'/'react'` 解析到
  // `remotion/node_modules/` 那一份, 而 `@remotion/player`(装在主项目根 node_modules)
  // 用的是根目录那一份——两份 remotion + 两份 React 是独立模块实例, 各自
  // `createContext()` 出来的 Context 对象不是同一个引用, `useVideoConfig()`
  // 找不到 `<Player>` 提供的 Provider, 报 "No video config found"(实测复现)。
  //
  // 用 webpack alias 把 `remotion`/`react`/`react-dom` 这三个裸导入**在主项目的
  // webpack 编译里**强制解析到根 node_modules 的同一份, 让 Film 与 Player 共用同一个
  // 模块实例、同一个 Context 对象。这条 alias 只影响主项目自己的 webpack 实例
  // (Next.js 打包浏览器/SSR bundle 时用的那个), 不碰 `remotion/` 子项目自己的
  // `bundle()`(独立 webpack 实例, 服务器出片走这条, 不吃这份配置)——两边互不干扰。
  webpack: (config) => {
    // 注意: 必须用 `$` 精确匹配裸导入本身, 不能匹配子路径——不加 `$` 时 webpack
    // 会把 `react-dom/server.edge` 这类子路径也一并重写成
    // `<路径>/server.edge`, 绕过 react-dom 的 package.json `exports` 条件导出
    // 映射, 导致 Next.js 内部 SSR 用到的 `react-dom/server.edge` 解析到错误的
    // 文件、缺 `preload` 等 API——实测复现: 不加 `$` 时全站(含 `/`、`/films`)
    // SSR 500, 不只是 spike 页面。
    config.resolve.alias = {
      ...config.resolve.alias,
      remotion$: path.resolve(__dirname, 'node_modules/remotion'),
      react$: path.resolve(__dirname, 'node_modules/react'),
      'react-dom$': path.resolve(__dirname, 'node_modules/react-dom'),
    };
    return config;
  },
};

module.exports = nextConfig;
