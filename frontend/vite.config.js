import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy: { '/api/v1': {
      target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://127.0.0.1:8080', changeOrigin: false,
    } } },
  };
});
