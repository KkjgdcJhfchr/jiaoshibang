import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { isLegacyAdminPagePath, isValidAdminEntryPath } from './server/admin-entry.mjs';

const adminEntryPath = String(process.env.ADMIN_ENTRY_PATH || '').trim();
if (adminEntryPath && !isValidAdminEntryPath(adminEntryPath)) {
  throw new Error('ADMIN_ENTRY_PATH 必须为 / 加 40 位 URL 安全随机字符，并包含大小写字母、数字和 - 或 _');
}

const adminEntryDevelopmentRouter = {
  name: 'admin-entry-development-router',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://vite.local');
      if (isLegacyAdminPagePath(url.pathname)) {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('Not Found');
        return;
      }
      if (adminEntryPath && url.pathname.startsWith(adminEntryPath)) {
        if (url.pathname !== adminEntryPath) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end('Not Found');
          return;
        }
        request.url = `/admin.html${url.search}`;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [adminEntryDevelopmentRouter, react()],
  server: {
    port: 5188,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        teacher: resolve('index.html'),
        admin: resolve('admin.html'),
      },
    },
  },
});
