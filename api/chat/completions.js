/**
 * POST /api/chat/completions —— 托管模式的转发口，形状和 OpenAI 完全一致。
 *
 * 路径故意跟 OpenAI 一模一样：前端 llm.ts 里那套 `{baseUrl}/chat/completions`
 * 拼接逻辑不用为托管模式写第二份，SSE 解析也是同一段代码。
 *
 * OPTIONS（跨域预检）也落在同一个文件里：前端发的是 `content-type: application/json`，
 * 属于非简单请求，浏览器一定会先发预检 —— 这个文件不接的话预检就是 404。
 */
import { handlerFor } from '../_handler.js'

export const config = { runtime: 'edge' }

export default function handler(request) {
  return handlerFor(process.env).handle(request)
}
