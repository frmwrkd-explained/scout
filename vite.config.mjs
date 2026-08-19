import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.SCOUT_DEV_PORT) || Number(process.env.PORT) || 5178,
    // SCOUT_API_PORT (not PORT — dev-server harnesses set PORT for vite itself);
    // 127.0.0.1, not localhost: the backend binds IPv4 only and macOS resolves localhost to ::1
    proxy: { '/api': 'http://127.0.0.1:' + (Number(process.env.SCOUT_API_PORT) || 5177) }
  },
  build: { outDir: 'dist' }
});
