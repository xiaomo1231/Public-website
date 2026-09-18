import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Everything this app stores lives in IndexedDB, which the browser scopes
    // to the origin. Without `strictPort`, Vite silently falls back to 5174,
    // 5175, … whenever 5173 is taken — a different origin, therefore a
    // different (empty) database, which looks exactly like "my AI settings
    // disappeared". Fail loudly instead of moving the origin.
    strictPort: true,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing dependencies into their own chunks so
        // the app shell stays small and caches well.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-db': ['dexie'],
          'vendor-math': ['mathjs'],
          'vendor-pdf': ['pdfjs-dist'],
        },
      },
    },
  },
})