import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'components': resolve(__dirname, './src/components'),
      'services': resolve(__dirname, './src/services'),
      'state': resolve(__dirname, './src/state'),
      'hooks': resolve(__dirname, './src/hooks'),
      'utils': resolve(__dirname, './src/utils'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('/src/services/') || id.includes('/services/')) {
            return 'services';
          }
          if (id.includes('/src/utils/') || id.includes('/utils/')) {
            return 'shared-utils';
          }
        }
      }
    },
  },
  server: {
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  }
})