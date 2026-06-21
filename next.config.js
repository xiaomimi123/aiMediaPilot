/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // playwright-core 含 .ttf/.html 资源, 让 Next 不 bundle, 运行时从 node_modules 加载.
    serverComponentsExternalPackages: ['@prisma/client', 'playwright-core', 'playwright'],
  },
};

module.exports = nextConfig;
