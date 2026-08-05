/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // playwright-core 含 .ttf/.html 资源, 让 Next 不 bundle, 运行时从 node_modules 加载.
    serverComponentsExternalPackages: ['@prisma/client', 'playwright-core', 'playwright'],
  },
  // 二期 T6: /agent /dashboard /settings 壳页退役, 流量并入 cockpit 单页视图。
  // 精确匹配 — /agent/discover 等子路径不受影响。
  async redirects() {
    return [
      { source: '/agent', destination: '/?view=pipeline', permanent: false },
      { source: '/dashboard', destination: '/?view=review', permanent: false },
      { source: '/settings', destination: '/?view=settings', permanent: false },
      { source: '/settings/baseline', destination: '/?view=settings', permanent: false },
    ];
  },
};

module.exports = nextConfig;
