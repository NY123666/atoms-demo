/**
 * GET /api/health —— 前端的"这台代理在不在"探测口。
 *
 * 它必须回答两个问题（前端据此决定要不要把「托管模型」这个选项露出来）：
 *   1. 路走通了没有 —— 所以它一定要返回 JSON，而不是被 SPA 的 rewrite 兜成一张 HTML；
 *   2. 代理到底能不能干活 —— `ready: false`（上游没配 Key）时前端应该当作"不可用"，
 *      否则访客点到「托管模型」只会收到一个 503。
 */
import { handlerFor } from './_handler.js'

export const config = { runtime: 'edge' }

export default function handler(request) {
  return handlerFor(process.env).handle(request)
}
