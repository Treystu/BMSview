import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { splitVendorChunkPlugin } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    splitVendorChunkPlugin(),
    // Bundle analyzer - only in build mode
    process.env.ANALYZE && visualizer({
      filename: 'dist/bundle-analysis.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
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
    target: 'es2020',
    sourcemap: process.env.NODE_ENV === 'development',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: process.env.NODE_ENV === 'production',
        drop_debugger: process.env.NODE_ENV === 'production',
        pure_funcs: process.env.NODE_ENV === 'production' ? ['console.log', 'console.debug'] : [],
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks: (id) => {
          // React ecosystem
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }

          // Chart.js and related
          if (id.includes('chart.js') || id.includes('chartjs')) {
            return 'charts';
          }

          // Date/time libraries
          if (id.includes('date-fns') || id.includes('moment')) {
            return 'datetime';
          }

          // Large UI libraries
          if (id.includes('@mui') || id.includes('@mantine') || id.includes('antd')) {
            return 'ui-vendor';
          }

          // Testing libraries (shouldn't be in production but just in case)
          if (id.includes('@testing-library') || id.includes('jest')) {
            return 'testing';
          }

          // Keep syncManager exclusively in main bundle
          if (id.includes('syncManager') || id.includes('serviceWorker')) {
            return 'main-only';
          }

          // Keep localCache as a separate chunk
          if (id.includes('localCache')) {
            return 'local-cache';
          }

          // Bundle optimization utilities
          if (id.includes('bundleOptimization') || id.includes('performance')) {
            return 'optimization';
          }

          // Error handling and validation
          if (id.includes('asyncErrorHandler') || id.includes('validation') || id.includes('errorBoundary')) {
            return 'error-handling';
          }

          // State management
          if (id.includes('enhancedAppState') || id.includes('appState')) {
            return 'state-management';
          }

          // Components by feature
          if (id.includes('AnalysisResults')) {
            return 'analysis-components';
          }
          if (id.includes('FileUpload')) {
            return 'upload-components';
          }
          if (id.includes('SystemManagement')) {
            return 'system-components';
          }

          // Services
          if (id.includes('geminiService') || id.includes('clientService')) {
            return 'api-services';
          }

          // Large vendor libraries
          if (id.includes('node_modules') && (
            id.includes('lodash') ||
            id.includes('ramda') ||
            id.includes('rxjs') ||
            id.includes('socket.io')
          )) {
            return 'utils-vendor';
          }

          // Isolate main app components
          if (id.includes('App.') || id.includes('main.')) {
            return 'main-app';
          }
        },
        // Optimize chunk naming
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'react-vendor') {
            return 'assets/react-[hash].js';
          }
          if (chunkInfo.name === 'charts') {
            return 'assets/charts-[hash].js';
          }
          if (chunkInfo.name?.includes('vendor')) {
            return 'assets/vendor-[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        // Optimize asset naming
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name?.split('.') || [];
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return 'assets/images/[name]-[hash].[ext]';
          }
          if (/css/i.test(ext)) {
            return 'assets/styles/[name]-[hash].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        },
      },
      // External dependencies that shouldn't be bundled
      external: [],
      // Tree shaking configuration
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
    },
    // Chunk size warnings
    chunkSizeWarningLimit: 500, // KB
    assetsInlineLimit: 4096, // 4KB - inline smaller assets as base64
  },
  server: {
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
    ],
    exclude: [
      // Exclude large libraries that should be loaded dynamically
      'chart.js',
    ],
  },
  // Define global constants for tree shaking
  define: {
    __DEV__: process.env.NODE_ENV === 'development',
    __PROD__: process.env.NODE_ENV === 'production',
    __TEST__: process.env.NODE_ENV === 'test',
  },
})