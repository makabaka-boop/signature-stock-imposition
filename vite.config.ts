import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 纯前端离线应用：开发期 Vite 服务，构建为静态文件由 Nginx 托管。
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
