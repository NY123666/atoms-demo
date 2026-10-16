/**
 * Cloudflare Workers 版入口（也在 Deno / Bun 上直接可用）。
 *
 * 部署：
 *   npx wrangler deploy server/worker.mjs --name forge-hosted
 *   然后 wrangler secret put UPSTREAM_API_KEY   # 把 Key 存成 secret，别写进 wrangler.toml
 * 需要的变量：UPSTREAM_BASE_URL / UPSTREAM_API_KEY / UPSTREAM_MODEL
 * （可选：HOSTED_DAILY_PER_IP / HOSTED_DAILY_GLOBAL / HOSTED_MAX_PROMPT_CHARS / HOSTED_MAX_TOKENS）
 *
 * 和 Vercel 那版一样做了记忆化：Workers 的 isolate 会复用模块作用域，
 * 每个请求重建 handler 会让内存计数归零、限流失效。
 */
import { createHostedHandler } from './hosted-core.mjs'

let cached = null

export default {
  fetch(request, env) {
    if (!cached) cached = createHostedHandler({ env })
    return cached.handle(request)
  },
}
