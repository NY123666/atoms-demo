/**
 * 本地跑托管代理的最小服务器（`npm run hosted:dev`）。
 *
 * 两个用途：
 *   1. 自己调托管模式时用（vite 那边 `npm run dev` 会把 /api 代理到这里，见 vite.config.ts）；
 *   2. `npm run smoke:hosted` 也用它起一个真的 HTTP 服务，让集成测试打真实端口。
 *
 * 它只做 node http ↔ Web Request/Response 的搬运，业务逻辑一行都不在这里 ——
 * 这样"本地测过的"和"部署上去跑的"是同一份 hosted-core.mjs。
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createHostedHandler } from './hosted-core.mjs'

export function startDevServer({ port = 8787, env = process.env, log = undefined } = {}) {
  const say = log || console.log
  /* log 透传给 handler：不传就是 console.error（本地开发想看到上游报错），
     集成测试传一个收集器进来，好断言"日志里也不会出现 Key"。 */
  const { handle, config } = createHostedHandler({ env, log })

  const server = createServer(async (req, res) => {
    const url = `http://${req.headers.host || `127.0.0.1:${port}`}${req.url}`
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0

    /*
     * 这几个头是"这一跳"的连接属性，不能跟着转给下一跳：
     * content-length 会因为 body 被重新编码（Buffer → 流）而对不上，
     * connection / transfer-encoding 更会让 undici 直接报错。
     */
    const headers = { ...req.headers }
    for (const name of ['content-length', 'connection', 'transfer-encoding', 'keep-alive']) delete headers[name]

    let response
    try {
      response = await handle(
        new Request(url, {
          method: req.method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
        }),
      )
    } catch (err) {
      say('[forge-hosted] dev server 里未捕获的错误：', err && err.message)
      response = new Response(JSON.stringify({ error: { message: '代理内部错误', code: 'internal' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }

    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res)
    } else {
      res.end()
    }
  })

  return {
    server,
    config,
    /* port 传 0 时由系统分配，返回值里给真实端口 —— 集成测试就能并行跑、不怕端口被占。 */
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          const addr = server.address()
          const actual = typeof addr === 'object' && addr ? addr.port : port
          resolve(`http://127.0.0.1:${actual}`)
        })
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/** `node server/dev.mjs` 直接跑起来（被 import 时不会执行）。 */
if (process.argv[1] && process.argv[1].endsWith('dev.mjs')) {
  const { listen, config } = startDevServer({ port: Number(process.env.PORT || 8787) })
  const base = await listen()
  console.log(`[forge-hosted] 托管代理已启动：${base}`)
  console.log(`[forge-hosted] 上游：${config.upstreamBase} / 模型：${config.model}`)
  console.log(
    `[forge-hosted] 配额：每 IP ${config.dailyPerIp} 次/天，全局 ${config.dailyGlobal} 次/天；` +
      `上游 Key：${config.upstreamKey ? '已配置' : '**未配置**（/api/health 会返回 ready:false，转发会返回 503）'}`,
  )
}
