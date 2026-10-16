import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * dev 期托管代理的地址（`npm run hosted:dev`，默认 8787）。
 * 刻意不引 @types/node：整个应用只在浏览器里跑，为了在这里读一个环境变量
 * 就可能顺手放行一堆 node-only 写法（fs / require），而它们在这个包里本就是不该出现的。
 * 所以只把 globalThis 上的 process.env 声明成需要的那一个形状。
 */
const DEV_PROXY_TARGET =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HOSTED_DEV_ORIGIN ||
  'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  // Relative base so the built site works on any static host / sub-path.
  base: './',
  server: {
    port: 5173,
    host: true,
    /*
     * 开发期把 /api 打到本地的托管代理。
     * 这样前端里的同源探测逻辑（src/lib/hosted.ts）在 dev / 线上是同一条代码路径，
     * 不需要为本地开发加任何开关。代理没起时这里返回 500，探测会如实判定"不可用"。
     */
    proxy: { '/api': { target: DEV_PROXY_TARGET, changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
})
