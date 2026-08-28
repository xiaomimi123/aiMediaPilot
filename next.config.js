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
};

module.exports = nextConfig;
