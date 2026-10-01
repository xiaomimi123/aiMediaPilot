/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  // 2026-10 改版: 复盘并入「作品 · 已发布」, 定位并入「设置」
  async redirects() {
    return [
      { source: '/retro', destination: '/works?stage=published', permanent: true },
      { source: '/persona', destination: '/settings#persona', permanent: true },
    ];
  },
};

module.exports = nextConfig;
