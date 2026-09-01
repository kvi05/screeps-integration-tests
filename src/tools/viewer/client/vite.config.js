import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxy target — the UI server started with `npx sit --viewer`.
// Pin the UI server port so the proxy can reach it:
//   terminal 1:  SIT_VIEWER_PORT=3100 npx sit --viewer --viewerPort 3100
//   terminal 2:  npm run dev            (this dev server, with HMR)
const apiTarget = `http://127.0.0.1:${process.env.SIT_VIEWER_PORT || 3100}`;

export default defineConfig({
    plugins: [react()],
    base: './',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            '/api': apiTarget,
            '/snapshots': apiTarget,
        },
    },
});
