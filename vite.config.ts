import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the built site works on any static host / sub-path.
  base: './',
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
})
