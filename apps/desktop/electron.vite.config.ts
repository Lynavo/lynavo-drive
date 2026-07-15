import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

const envDefine = {
  'process.env.LYNAVO_RELEASE_CHANNEL': JSON.stringify(process.env.LYNAVO_RELEASE_CHANNEL || ''),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: envDefine,
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: envDefine,
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(projectRoot, 'src/renderer'),
      },
    },
    define: envDefine,
    optimizeDeps: {
      include: ['@lynavo-drive/contracts', '@lynavo-drive/design-tokens'],
    },
    plugins: [react()],
  },
});
