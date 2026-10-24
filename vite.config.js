import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));

// Three pages: landing, laptop (host) and phone (play).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        host: resolve(root, 'host.html'),
        play: resolve(root, 'play.html'),
      },
    },
  },
});
