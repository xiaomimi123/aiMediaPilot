import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig.json 的 jsx: "preserve" 是给 Next.js 自己的编译器用的；vitest 跑在
  // Vite/esbuild 之上，需要显式声明 automatic runtime 才能把 .tsx 测试文件里的
  // JSX 编译成可执行代码 (否则 esbuild 会原样保留 JSX，报 "React is not defined")。
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx,js}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
